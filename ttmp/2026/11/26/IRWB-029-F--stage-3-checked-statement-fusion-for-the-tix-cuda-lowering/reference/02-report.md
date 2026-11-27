---
Title: Checked statement fusion, measured
Ticket: IRWB-029-F
Status: active
Topics:
    - compiler
    - ir
    - verification
    - cuda
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/fusion.ts
      Note: The pure planner that decides fusion and refusals from the Tix IR
    - Path: repo://src/tensor/cuda-source.ts
      Note: Row-group and chain kernels behind options.fuse
    - Path: repo://ttmp/2026/11/26/IRWB-029-F--stage-3-checked-statement-fusion-for-the-tix-cuda-lowering/scripts/03-corpus-measurements.mjs
      Note: Reproduces every table in this report
    - Path: repo://ttmp/2026/11/26/IRWB-029-F--stage-3-checked-statement-fusion-for-the-tix-cuda-lowering/scripts/04-softmax-attributes.mjs
      Note: The stage 2 timings that bound the fused softmax
ExternalSources: []
Summary: Stage 3's fused lowering: 4/4/6/3 statements become 1/1/2/2 kernels, bit-identical, checked exact, with per-kernel byte counts and honest speedups.
LastUpdated: 2026-11-26T21:40:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked statement fusion, measured

Stage 2 launched one CUDA kernel per Tix statement, and every intermediate tensor lived in global memory. Stage 3 fuses statements into fewer kernels without changing any result bit. The fused lowering is decided by a pure planner on the Tix IR, rendered by the stage 2 emitter, and judged by the same exact GPU contract: bit-identical to the current revision's f32 meaning, NaN compared as a class, over the stage 1 sample recipes. `fuse: false` is the stage 2 lowering, verified byte-identical to the emitter at this branch's base commit. Every number below was measured on the GB10 (sm_121, CUDA 13.0.88) unless marked as an argument.

## Where fusion lives, and why

**A pure planner plus the emitter.** `src/tensor/fusion.ts` reads the resolved function and returns an ordered list of segments — single statements and fused groups — together with the reason for every refusal. `cuda-source.ts` emits one kernel per segment. Legality is therefore decided from the Tix IR, before emission applies anything.

- *Not a pass on the Tix IR.* A fused group computes several tensors of different shapes in one kernel; a Tix statement defines exactly one tensor with one shape, so a group is not expressible without a multi-output statement form, a new artifact schema and a new meaning for the stage 1 contract. A pass would also advance revisions as a side effect of the pure `cudaSource` and `checkLowering`.
- *Not a kernel-IR artifact.* The plan is a deterministic function of the current revision, so it needs no revision identity of its own. The translation unit is already carried by the versioned CUDA source artifact, whose content hash distinguishes fused from unfused candidates, and the exact differential check judges the fused lowering end to end.

**The correspondence finding is a non-finding.** The framework's correspondence does not have to express "many statements become one kernel", because the checked transformation is artifact-level — one Tix IR artifact in, one CUDA source artifact out — exactly as in stage 2. Which statements each kernel computes is a pure function of the input revision (`fusionPlan`) and observable as the `__global__` count. Giving the CUDA artifact kernel entities and an entity-level correspondence would add ceremony no current contract consumes.

## What fuses, and what is refused

A group is an interval of consecutive statements sharing a **row dimension** D: every statement's leading axis has extent D, every load is *row-local* (leading index exactly the row binder, tensor's leading dimension D) or *row-free* (the row binder absent from the address), and a row-free read of a group tensor is refused because it reads another row. Two mappings:

- **Row groups — one warp per row.** Each warp stages its own row slice of a static 12,288-float shared array: row-local parameters and pre-group statements by one cooperative coalesced copy, in-group statements by writing their computed slice (plus global, when the statement also has consumers outside the group). Statements run in definition order, separated by `__syncwarp()`; the row guard is warp-uniform. If a launch's need exceeds the shared cap, the kernel stages through the statements' own global buffers instead — same values, same order, still one kernel.
- **Register chains — one thread per output element.** When every statement in the group has the same shape after the row axis and every in-group read is elementwise at the reader's own coordinates, stage 2's own mapping computes the whole chain per thread, forwarding producer values through registers. Reductions are allowed: each element runs its own sequential loops, exactly as in the stage 2 kernel.

| Program | Fusions applied | Kernels |
| --- | --- | ---: |
| matmul | none: a single statement has nothing to fuse with | 1 → 1 |
| softmax | m, e, s, y → one row group; x staged, e staged, m and s as lane-0 sequential chains | 4 → 1 |
| layernorm | mean, centered, variance, y → one row group; x and centered staged | 4 → 1 |
| attention | score, shift, e, z, weight → one row group; q and score staged | 6 → 2 |
| mlp | h, g → one register chain (the GELU epilogue on the dense layer); h never reaches global memory | 3 → 2 |
| conv2d | none: single statement | 1 → 1 |

**Refused, with reasons.** The legality refusals (each covered by a test): a row-free read of a group tensor (a cross-row reduction); a shifted row address (`x[i+1,j]`); a row axis that is not the statement's leading axis; a row dimension that differs from the group's. The performance refusal, measured before it was made a rule: **a contraction whose reduction body loads a row-free matrix operand never joins a group** — fusing mlp's second contraction into its row group serialized a 1024-long dot into each lane and ran at **2.40 ms against 0.94 ms** unfused; attention's output contraction has the same shape. Such a statement may still start a group, which is how mlp's dense layer keeps its GELU epilogue. One refusal I chose not to make: a parallel max *is* provably bit-exact (the fold is commutative and associative, including NaN and mixed-zero semantics), but reassociating a reduction is explicitly outside this stage, so softmax's max stays a lane-0 sequential chain. That is the single largest known headroom left on the table.

## Kernel counts, benchmark times, bytes

Kernel counts come from the emitted source; times are the median of three CUDA-event intervals after a warm-up (`benchmark: true`, under the tool's `--timed` lock); bytes are my analytic count over the plan and IR — a load site inside reductions runs elements × enclosing-extent product times, staged loads count once per row, and only externally consumed statements are written. The 244 GB/s column is that byte count's streaming time. The byte count models issued loads, not DRAM traffic: cache hits are why matmul measures 0.21 ms against a 4.4 ms "ideal", so the ideal column is a floor for cold streaming only, not a predictor.

| Program (sizes in the brief) | Kernels | GPU ms, median | Bytes, fused | Ideal at 244 GB/s, fused |
| --- | ---: | ---: | ---: | ---: |
| matmul 512³ | 1 → 1 | 0.217 → 0.210 | 1074.8 MB → 1074.8 MB | 4.405 ms → 4.405 ms |
| softmax 4096×1024 | 4 → 1 | 0.796 → 0.723 | 134.3 MB → **33.6 MB** | 0.550 ms → 0.138 ms |
| layernorm 4096×1024 | 4 → 1 | 0.475 → 0.233 | 201.4 MB → **83.9 MB** | 0.825 ms → 0.344 ms |
| attention 1024², 64 | 6 → 2 | 1.048 → 0.924 | 1111.8 MB → 810.0 MB | 4.556 ms → 3.320 ms |
| mlp 1024/256/1024/256 | 3 → 2 | 0.944 → 0.851 | 4330.6 MB → 4326.4 MB | 17.75 ms → 17.73 ms |
| conv2d 8/16/64/64/32 | 1 → 1 | 0.166 → 0.164 | 1137.6 MB → 1137.6 MB | 4.662 ms → 4.662 ms |

Per kernel, fused (reads + writes; unfused in the script's output): softmax one kernel, x staged once and y written, 16.8 + 16.8 MB. Layernorm one kernel: x staged, mean/variance lane-0 chains, 67.1 + 16.8 MB. Attention: the row group stages q and reads k per score element (268.7 + 4.2 MB), then `out` keeps its own kernel (536.9 + 0.3 MB). Mlp: the h+g chain (2172.6 + 4.2 MB — g is external because `y` reads it) and `y` alone (2148.5 + 1.0 MB). The mlp byte count barely moves because the dominant traffic is the dense weights and value matrix, which no legal fusion removes — the win is one launch fewer and h's round trip gone.

The fused and unfused GPU outputs are bit-identical (NaN as a class) on every measured input, and the sha256 digests of the f32 output words match between the two lowerings for all six programs.

## Why softmax is only 1.10×, measured

The brief's earlier prototype ran 4.25× faster than stage 2. Our fused softmax removes the same traffic (134 MB → 34 MB) but only cuts time from 0.796 to 0.723 ms. The attribution probe ([script 04](../scripts/04-softmax-attributes.mjs)) times stage 2's four statements as standalone kernels at the same size: max-per-row 0.113 ms, **exp over the tensor 0.369 ms**, sum-per-row 0.114 ms, divide 0.103 ms — which sum to the measured stage 2 total. The exact relation forces the double-precision transcendental path (the single-precision `expf` differs on 16,615 of the probe's 102,461 inputs, per stage 2's arithmetic probe), so 4.2M double `exp` calls alone cost 0.369 ms on this machine; 0.185 ms is not reachable bit-identically here. What remains of the fused kernel's 0.723 ms is the two order-preserving lane-0 chains (max and sum) plus the exps, with roughly seventy rows in flight — shared capacity (8.2 KB per staged row) bounds concurrency, not the warp count. A parallel max tree would be exact, but reassociation is out of scope; it is the recorded headroom for a later stage.

## Framework and tool changes: none required

No file under `src/framework/` or `tools/` changed. The candidates and why they lost: a kernel-IR artifact and entity correspondence (rejected above — restatement plus ceremony with no consuming contract); a multi-output Tix statement (a schema change to express what the plan already represents); exposing `runCudaBatch`'s benchmark mode (a pass-through option in `src/tensor`, not a framework change — the runner's `--timed` lock, per-key compile cache and `--` program arguments already served it). The exact differential invariant, the batched `decide`, evidence replay and the in-flight batch sharing all work unchanged for fused subjects, because the fused translation unit is just a different source artifact revision. The changes this stage made are confined to `src/tensor/` (planner, emitters, `fuse`/`benchmark` options threading) and `tests/tensor/`.

## What the contract checks, and what it costs

`checkLowering(program, fn, {fuse})` runs the same checked transformation as stage 2 with the fused (or unfused) emitter: it generates the stage 1 deterministic cases — every shape symbol sized 1, 3, 4, 7 and a distinct-size mixed assignment, plus all-zero and one-zero-at-a-time assignments for empty extents; signed, positive, half-ULP and signed-zero streams; at most 4,096 elements per tensor and 10⁶ metered evaluator steps — evaluates the current revision in f32 as the reference, and sends every undecided case to the GB10 in one batch, comparing output words exactly with NaN as a class. Measured cost per corpus function: **2.3–3.2 s cold** (case generation, the f64 reference, one ssh round trip, one compile when the source is new, one run), **~1 ms warm** (verdict replay from the memo). The fused and unfused lowerings are distinct source revisions, so each pays its own cold check; concurrent checks in the same mode share the in-flight batch. The stage 2 mutants still rejected under the exact relation, plus a new fused mutant (the row maximum folded as a minimum — a compiling kernel with wrong bits), confirm the check's sensitivity on the fused source.

## Measured, and argued

**Measured:** kernel counts; benchmark medians (fused and unfused, one warm-up plus three intervals, single runs subject to the machine's variance); fused-vs-unfused output word equality at full size; fused-vs-meaning bit equality and contract acceptance on the corpus (original and optimized) and on the fallback, chain and refusal cases; a seven-program sweep over rank-1..3 programs, chains with reductions, refused plans and epilogues, original and optimized revisions, at four assignments each including empty extents — all bit-identical ([script 06](../scripts/06-random-sweep.mjs); two initial sweep "failures" were the sweep's own out-of-domain inputs, reads past an empty tensor, where stage 2 behaves identically); the softmax attribution timings; contract cold/warm times; `fuse:false` byte-parity with the base emitter.

**Argued, not measured:** the analytic byte counts and their 244 GB/s times (a load-issue model that ignores caches — where a measured time beats the "ideal", as in layernorm, cache hits are why); bit-identity at sizes the contract does not sample (the structural argument: same expression tree, same rounding sites, same sequential reduction order, staging changing only where a computed word is read from, plus the full-size fused≡unfused equality as evidence).

## Later

- A parallel max tree: provably bit-exact for `max` (commutative, associative, NaN- and zero-safe), blocked only by this stage's no-reassociation boundary. The biggest single win available to softmax.
- Per-tensor shared/global staging placement when one oversized tensor currently forces a whole group to global staging.
- Non-consecutive grouping and multi-group row axes; contraction tiling for data reuse, split-K, tensor cores, streaming attention and autotuning, all outside this stage by the brief.
