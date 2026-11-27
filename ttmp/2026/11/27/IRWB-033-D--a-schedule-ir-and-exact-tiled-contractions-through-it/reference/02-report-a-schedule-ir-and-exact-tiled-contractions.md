---
Title: 'Report: a schedule IR and exact tiled contractions'
Ticket: IRWB-033-D
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/schedule.ts
      Note: Schedule IR, adapter, passes with legality, order analysis
    - Path: repo://src/tensor/strategy.ts
      Note: The scheduling rule, tile configurations and the launch rule
    - Path: repo://src/tensor/cuda-contraction.ts
      Note: Printer of contraction kernels
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Framework change, pass legality
    - Path: repo://tests/tensor/schedule-gpu.test.mjs
      Note: GB10 checks of tiled variants, large shapes and mutants
ExternalSources: []
Summary: "A v6 schedule IR between Tix and CUDA; contractions are tiled by checked passes into four launch-time variants; every corpus program bit-identical and no slower; one framework change (pass legality)."
LastUpdated: 2026-11-27T11:03:56.829746495-05:00
WhatFor: Final report of stage 6 (IRWB-033-D)
WhenToUse: Reviewing the schedule IR, its passes and checks, and the contraction timings
---

# Report: a schedule IR and exact tiled contractions

Stage 6 puts a schedule IR between Tix and CUDA and makes contractions fast without changing a result bit. Lowering now goes Tix → fusion plan → schedule IR → checked scheduling passes → CUDA source. The printer only prints the schedule. Each output still adds its terms one at a time, r = 0, 1, … in the meaning's order, with the product and the sum rounded separately.

At the brief's sizes, comparing fused against the base's fused lowering:

- matmul 512³ went from 0.218 ms to 0.046 ms (5.9 TFLOP/s, 1.39 times cuBLAS's time);
- attention from 0.750 to 0.184 ms;
- mlp from 0.626 to 0.219 ms;
- conv2d from 0.167 to 0.100 ms.

Every output was bit-identical across all sides and variants, and no corpus program got slower. One framework change: passes gained a legality check decided before they run.

The code is at the last commit of branch `t6-op/irwb-033-d`. Design: `design-doc/01-a-schedule-ir-between-tix-and-cuda-and-exact-tiled-contractions.md`. Diary: `reference/01-implementation-diary.md`.

## Results

GPU time is `runTixCuda(..., { benchmark: true })`: one warm-up launch, then the median of three CUDA-event intervals, under the runner's `--timed` lock. Each table entry is the **median of five such calls**, with the sides alternated (fused, unfused, base, fused, …), as the brief's protocol asks (scripts 03 and 06; raw values in `scripts/06-final-*.out.jsonl`). Inputs are seed 20, f32 in [−0.1, 0.1], eps = 1e-5. *Base* is the fused lowering of this branch's first commit (stage 3b), built by script 06. Kernel count is the number of `__global__` definitions in `cudaSource`.

The tables below were measured at commit 6198832. The last commit adds one line to the launch rule (variant 0 below one tiled block per SM, after the dot product below). No shape in these tables falls under it: attention's out, the smallest grid, has 64 blocks, so every choice and kernel is the same. I did not read the SM clock during 4096³. Its five fused calls spread by 0.6% (15.72 to 15.82 ms).

### Corpus programs

| Program | Kernels | Fused ms (5 calls) | Unfused ms | Base fused ms | Fused / base | Fused / unfused | Identical |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| matmul-512 | 1 | **0.0457** (0.0452, 0.0454, 0.0462, 0.0463, 0.0457) | 0.2148 | 0.2178 | 0.21 | 0.21 | yes |
| softmax | 1 | **0.3855** (0.3855, 0.3861, 0.3813, 0.3874, 0.3811) | 0.8132 | 0.3861 | 1.00 | 0.47 | yes |
| layernorm | 1 | **0.1477** (0.1477, 0.1345, 0.1528, 0.1496, 0.1376) | 0.4777 | 0.1712 | 0.86 | 0.31 | yes |
| attention | 3 | **0.1844** (0.2082, 0.1847, 0.1844, 0.1835, 0.1835) | 1.0498 | 0.7497 | 0.25 | 0.18 | yes |
| mlp | 2 | **0.2187** (0.2185, 0.219, 0.2187, 0.2549, 0.2175) | 0.9411 | 0.6260 | 0.35 | 0.23 | yes |
| conv2d | 1 | **0.0999** (0.0999, 0.0996, 0.1001, 0.099, 0.0999) | 0.1662 | 0.1672 | 0.60 | 0.60 | yes |

- softmax and layernorm have no contraction. Their schedules have no pass applied, and their sources are those of the base. Layernorm's 0.86 against base is the session's noise: the five base calls spread from 0.15 to 0.19 ms on a GPU shared with about eleven agents.
- **Kernels:** attention now has 3 kernels (score; the row softmax `shift, e, z, weight`; out), mlp has 2 (`h` with `g` as its epilogue; `y`). Each is one `__global__` definition. Isolating the contractions is what gives attention and mlp their speed (below).

### Contractions, fused (tiled) and unfused (stage 2)

The contractions inside attention and mlp are timed as standalone Tix programs of the same statement and shapes (`attention-score`: `s[i,j] = (sum(d) q[i,d] * k[j,d]) / sqrt(D)`; `attention-out`: `o[i,c] = sum(j) w[i,j] * v[j,c]`; `mlp-h`: `h = x·w + bias`; `mlp-y`: `y = g·v + outBias`). TFLOP/s = 2 M N K / time.

| Contraction | Fused ms | TFLOP/s fused | Unfused ms | TFLOP/s unfused | Fused / cuBLAS | Identical |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| matmul-512 | **0.0457** | 5.87 | 0.2148 | 1.25 | 1.39 | yes |
| conv2d | **0.0999** | 2.84 | 0.1662 | 1.71 |  | yes |
| attention-score | **0.0320** | 4.19 | 0.6176 | 0.22 | 1.81 | yes |
| attention-out | **0.0467** | 2.87 | 0.0966 | 1.39 | 2.16 | yes |
| mlp-h | **0.0771** | 6.96 | 0.4736 | 1.13 | 1.82 | yes |
| mlp-y | **0.0846** | 6.35 | 0.3842 | 1.40 | 1.78 | yes |
| matmul-4096 | **15.7541** | 8.72 | 133.4398 | 1.03 | 2.20 (19.2 TFLOP/s) | yes |

**Other shapes** (matmul; fused against unfused, same protocol; measured before the rule's last line, variant 0 for grids under one block per SM, was added: with it 1 × 1 × 4096 ran 0.0974 ms fused against 0.0971 unfused and 100³ 0.0086 against 0.0086, script 09):

| Other shape (M x N x K) | Fused ms | Unfused ms | Fused / unfused | Identical |
| --- | ---: | ---: | ---: | --- |
| 256x256x1 | 0.0032 | 0.0034 | 0.94 | yes |
| 1x1x4096 | 0.1580 | 0.0975 | 1.62 | yes |
| 4096x1x1024 | 0.0683 | 0.1161 | 0.59 | yes |
| 100x100x100 | 0.0082 | 0.0088 | 0.93 | yes |
| 8x8x8 | 0.0029 | 0.0029 | 1.00 | yes |
| 777x333x129 | 0.0215 | 0.0483 | 0.45 | yes |

**The schedule chosen at these sizes** (the launch rule, below; all variants compiled into the same kernel):

| Contraction | Grid of v1 / v2 (blocks) | Terms | Variant | Tile, per thread, threads | Copies walk along |
| --- | --- | ---: | --- | --- | --- |
| matmul 512³ | 32 / 256 | 512 | 2 | 32×32×8, 4×4, 64 | a: r (k), b: n (j) |
| matmul 4096³ | 2,048 / 16,384 | 4,096 | 1 | 128×64×8, 8×4, 256 | a: r, b: n |
| attention score | 128 / 1,024 | 64 | 3 | 32×32×8, 2×2, 256 | q: r (d), k: r (d), the transposed operand |
| attention out | 16 / 64 | 1,024 | 3 | 32×32×8, 2×2, 256 | weight: r (j), v: n (c) |
| mlp h | 128 / 1,024 | 256 | 2 | 32×32×8, 4×4, 64 | x: r, w: n |
| mlp y | 32 / 256 | 1,024 | 2 | 32×32×8, 4×4, 64 | g: r, v: n |
| conv2d | 241 / 961 | 144 | 3 | 32×32×8, 2×2, 256 | x: m (xpos), kernel: r (dx) |

All of them stage both operands in shared memory as transposed tiles, with n tiles on `blockIdx.x`.

### Every variant forced (script 03 `--variants`, the basis of the launch rule)

| Contraction | v0 one thread per output | v1 128×64 / 8×4 | v2 32×32 / 4×4 | v3 32×32 / 2×2 |
| --- | ---: | ---: | ---: | ---: |
| matmul-512 | 0.2131 | 0.0619 | 0.0457 | 0.0659 |
| attention-score | 0.6168 | 0.0382 | 0.0358 | 0.0320 |
| attention-out | 0.0953 | 0.1162 | 0.0545 | 0.0472 |
| mlp-h | 0.4640 | 0.0785 | 0.0785 | 0.1095 |
| mlp-y | 0.3834 | 0.1192 | 0.0846 | 0.1265 |
| conv2d | 0.1659 | 0.1559 | 0.1099 | 0.0995 |

At 512³ the fastest variant (0.046) is the one the rule picks. 128 × 64 tiles give only 32 blocks for the GPU's 48 SMs. At attention's out (N = 64) every tiled variant has at most 64 blocks, and the one with the most threads per block wins. The run was stopped before 4096³ and the odd shapes, because each shape took about four minutes on the shared GPU. 4096³ in the contraction table is the rule's choice (variant 1). Probe 01, hand-written kernels in the same scheme, timed all four variants at 4096³ (15.7 ms for variant 1's tile, 19.3 and 33.8 for the others).

## The schedule IR

`tensor.schedule` (version 1, `src/tensor/schedule.ts`) is a v6 artifact made with `defineIR` and a v6 adapter, so the framework's pass machinery applies to it. A schedule holds the algorithm (the Tix function, unchanged) and one schedule kernel per CUDA kernel:

| Construct | What it is | Printed by |
| --- | --- | --- |
| `pointwise` kernel | a fusion group in thread mode: one thread per element, members in registers | stage 2's and stage 3's printers, unchanged |
| `rows` kernel | a stage 3/3b block-mode group, its `FusionGroup` (staged terms, in-place rows, gate) unchanged | stage 3b's printer, unchanged |
| `contraction` kernel | a thread-mode group whose one reduction is a tileable contraction, with `dims`, `operands`, `variants` and `select` | the new printer (`cuda-contraction.ts`) |
| `dims` | the output axes only the first operand reads (`m`), only the second reads (`n`), the rest (`b`), and the reduction axes in the meaning's order (`r`); each flattened row-major | |
| variant | a loop nest over b, m, n, r: loops with `dim`, `level`, `factor` (null = the rest) and `bind`; and the operand tiles it stages | |
| `stage` | copy an operand's tile to shared memory at an r loop; `fast` = the dim consecutive threads copy along | |
| `select` | the launch rule: the first variant whose grid has at least `minBlocks` blocks per SM | the host |

A **tileable contraction** is a statement with exactly one reduction, outermost, a `sum` over `dim` extents, whose body is `X[...] * Y[...]` with X and Y computed elsewhere, and where each operand reads an output axis the other does not. The rest of the statement is its epilogue (attention's `/ sqrt(D)`, mlp's `+ bias[j]`, and mlp's `g`, which joins `h`'s kernel as a pointwise member). All five corpus contractions are tileable; conv2d gets m = (n, y, xpos), n = (o), r = (c, dy, dx).

The adapter's entities are kernels, variants (`k0/v1`), loops (`k0/v1/m.1`) and stages (`k0/v1/stage.m`); `entities(value)` on the IR lists the same IDs, so the contracts manager's F23 check applies to schedule correspondences.

**Printable form.** The printer accepts variant 0 (every output loop bound to `thread`: one thread per output, stage 3's thread-mode code) and one tiled form: `b.0 block.z; m.0, n.0 on block.x/y; m.1 thread.y; n.1 thread.x; r.0 serial; r.1, m.2, n.2 unroll`, both operands staged at `r.0`. It reads every number from the schedule (tile extents, threads, which dim each copy walks, which grid axis numbers which tiles, the launch bound and the rule) and decides nothing. Anything else is valid IR that it rejects ("schedule not printable: expected loop 1 to be m.0 ..."; tested). The strategy's intermediate revisions are therefore not printable; they are checked at the IR level only.

*Considered instead:* (a) no schedule IR, the tile sizes as plan fields, which is what the brief rejects and would leave nothing for a step check to look at; (b) a general loop-nest printer for any nest. The single printable form is the simplest that lets every step be a separate pass; a general printer is Later.

## The passes

Each is a `definePass` on the schedule IR, with its legality decided from the IR before it runs (the framework's new `legal` hook) and a correspondence to the revision before (the framework's `makeCorrespondence`, with explicit entries where entities split or are renamed).

| Pass | Legality (refused before `run`) | Correspondence |
| --- | --- | --- |
| `isolate` | some rows kernel computes a tileable contraction; the new groups are `planFusion(fn, { noBlock })` | old kernels to new kernels, grouped by shared statements (`refused-fusion`) |
| `contraction` | a pointwise kernel; exactly one member has a reduction; it is tileable | kernel retained, variant 0 and its loops inserted |
| `variant` | a contraction kernel | new variant and loops inserted |
| `split` | the loop is serial; the factor is a positive integer dividing a fixed factor | loop to (outer, inner) `split`; deeper levels `renamed` |
| `reorder` | a permutation; r loops keep their relative order | retained |
| `bind` | r loops only `serial` or `unroll` (else a reassociation); a hardware index once per variant; `thread.*` and `unroll` need fixed factors | retained |
| `stage` | `at` is an r loop; the tile's loops are fixed; tile under 24 KiB | stage inserted |
| `select` | the variants exist; the last entry takes every grid | retained |

**Every application is gated by the order analysis** (`accumulationOrder`, passed as the gate of `applyNativePassSync`). For each statement with a reduction it gives the order in which each output receives its terms. A rows or pointwise kernel has the meaning's order by construction (stage 2's scalar code; stages 3 and 3b). For a contraction kernel the analysis checks every variant:

1. no r loop is bound to a block or thread index;
2. **simulating the nest** at small extents that are not multiples of any factor (b, m, n, r = 2, 5, 3, 11; 1, 7, 2, 1; 3, 1, 1, 0), the r loops alone, in nest order, enumerate r = 0, 1, …, R − 1, and each output dim's loops reach each value exactly once.

Simulating per dim is exact for this IR, not an approximation: the accumulator is indexed by the output point, so loops of other dims cannot change the sequence of terms one output receives. If every variant passes, the value is `lexicographic(<r axes>)`, the same string a scalar kernel gets; otherwise it names the variant and the first wrong sequence. The gate requires equal values before and after, so a step that changed any output's order is rejected (`contractRejected`) and not published.

**What this covers.** The test `schedule.test.mjs` applies a rogue pass that swaps the factors of r.0 and r.1, so that no loop moves and `reorder`'s legality could not see it; the gate rejects it with "r in the order 0 4 8 1 5 9 …". Legality refuses a reorder of r loops, a reduction loop bound to `thread.x` and the others above. **What it does not cover:** the printer. Two printer mutants (terms in reverse inside a tile; tiles padded with 1 instead of 0) pass every IR check and are rejected by the GPU check, with the variant and a coordinate (`schedule-gpu.test.mjs`). The GPU check is also what covers the padding argument (below) at run time.

**Padding is exact (argued).** Tiles are zero beyond the extents. A padded term is `__fmul_rn(0, 0) = +0`, and `acc + (+0) = acc` unless acc is −0; acc starts at +0, and in round-to-nearest `x + y = −0` only when both are −0, so acc is never −0. Loads and stores through shared memory move words unchanged.

## The strategy, and where `src/framework/strategy` does not fit

`scheduleFunction(fn, plan, fuse)` (`src/tensor/strategy.ts`) applies, for the fused lowering:

1. `isolate` (skipped when illegal: no block group holds a tileable contraction);
2. for each pointwise kernel: `contraction` (skipped when illegal); then for each of three tile configurations: `variant`, `split` ×5 (m by TM then BM/TM, n likewise, r by BK), `reorder` to the printable order, `bind` ×8, `stage` ×2 with `fast` read from the operand's last index (the dim whose innermost axis it steps by 1);
3. `select`.

That is 53 applications per contraction kernel, each through `applyNativePassSync`. A function's schedule is memoized; the first scheduling takes 0.5 to 2.9 s of CPU on this (shared, loaded) machine for the corpus (script 05), mostly the framework's per-step projection, diff, correspondence and hashing.

The framework's strategy module would express this as a plan of `apply` and `forEach` nodes, and I planned to use it. **It does not fit:** its interpreter's `execute` is asynchronous, and `cudaSource` is synchronous by the fixed API, so a plan cannot produce the source `cudaSource` returns. *Proposed (not made):* an `executeSync` for plans whose algorithms are all synchronous. With it, the function above is a plan over the same passes, and the trace records each step.

**Fusion feeds the schedule from its plan.** `planFusion` decides groups from Tix reads; the schedule holds rows kernels as one construct, and changes fusion decisions with one kernel-level pass, `isolate`, which re-plans with `noBlock`. Re-expressing 3b's term staging, in-place rows and gate as loop-level passes would re-implement them without adding a check, because their argument (one thread per element, stage 2's scalar code) is unchanged.

**Why isolate.** Block mode computes a contraction with one block per output row, so each block re-reads the other operand from L2; the tiled kernel reads an operand tile once per tile of outputs. Isolation costs kernels: attention has 3 (`score`; `shift, e, z, weight`; `out`), mlp 2 (`h, g`; `y`). Its effect is in the corpus table: attention fused went from 0.75 to about 0.16 ms. *Refused alternative:* tiling inside block mode (several query rows per block, the scores of those rows in shared memory). It needs a multi-row form of 3b's emitter and is Later.

## Launch-time variants

The tile size depends on the shapes, which `cudaSource` does not know, so a contraction kernel has four variants in one `template <int V>` definition (one `__global__`), and the host picks one at launch:

| Variant | Tile m × n × r | Outputs per thread | Threads | Chosen when |
| --- | --- | --- | ---: | --- |
| 1 | 128 × 64 × 8 | 8 × 4 | 256 | its grid has at least 16 blocks per SM |
| 2 | 32 × 32 × 8 | 4 × 4 | 64 | else, at least 2 blocks per SM and 256 terms |
| 3 | 32 × 32 × 8 | 2 × 2 | 256 | else, at least 1 block per SM |
| 0 | one output per thread (stage 2's mapping) | 1 | 256 | otherwise, or when a tiled grid exceeds CUDA's limits |

Each threshold lies between the largest measured value at which the variant lost and the smallest at which it won (`strategy.ts` lists the measurements next to the constants): variant 1 tied variant 2 at 128 blocks (mlp's h) and won at 2,048 (4096³, probe 01); variant 2 lost to variant 3 at 1.3 blocks per SM (attention's out) and at 64 and 144 terms (attention's score, conv2d), and won at 5.3 blocks per SM with 256 to 1,024 terms (512³, mlp's h and y); variant 3 took 1.62 times stage 2's time with one block (a 1 × 1 × 4096 dot product) and 0.94 with 64 blocks. Between those points the rule is not measured. The last line was added after script 06 found the dot product slower; with it the dot product ran 0.0974 against 0.0971 ms unfused (script 09).

Choices, each with its reason:

- **Separate `__fmul_rn` and `__fadd_rn`, one accumulator per output, r ascending:** the meaning (fixed).
- **Register tiles** (8×4, 4×4, 2×2) and **shared-memory tiles of both operands**, BK = 8: probe 01's fastest at the brief's shapes.
- **Transposed tiles** (`As[BK][BM + 4]`, `Bs[BK][BN + 4]`): the inner loop reads TM consecutive m values for one k; the 4-float padding keeps the transposed copy free of bank conflicts and rows 16-byte aligned.
- **Vector reads from shared memory** (float4) when the per-thread extent is a multiple of 4; they need nothing at launch.
- **Coalesced copies:** consecutive threads copy along the dim that is contiguous in global memory (`fast`), read from the IR: r for `a[i,k]` and for attention's `k[j,d]` (the transposed operand), n for `b[k,j]`, m for conv2d's `x` (xpos).
- **`__launch_bounds__` per variant** (probe 04: without it, variants 1 and 2 ran 1.7 and 2.2 times slower at 512³).
- **n tiles on `blockIdx.x`** (probe 04: 0.050 to 0.044 ms for variant 2 at 512³; one measurement each, near the noise).

Refused: vector loads from global memory (alignment and divisibility are known only at launch: another variant axis); double buffering (not attempted in this session); larger BK (64×64×16 was 5 to 10% faster than ×8 in probe 01 at three shapes, but no variant uses 64×64); everything the brief excludes (split-K, tree reductions, FMA, tensor cores, timing candidates).

## New approaches tried

- **Order preservation from the IR, checked at every step.** Worked as far as it reaches: the analysis rejects a pass that changes any output's term order even when no loop moves (the rogue pass in `schedule.test.mjs`), and legality refuses the obvious ones before they run. It is cheap (a few hundred simulated points per variant, memoized). It does **not** remove the GPU check, because the printer is not verified against the nest: the two printer mutants pass every IR check. So the GPU check still covers the printer, the padding argument and the scalar code of epilogues; the IR check covers every scheduling step.
- **A correspondence through every step.** Each application yields a framework correspondence (split, renamed, inserted, refused-fusion entries). I did not compose them into one record from Tix statements to the final loops; the order analysis already follows each output's terms, and composition would need every step's entity universe kept. Not tried.
- **Shared rewrites between contractions and row kernels.** Not tried: rows kernels stay one construct (above).
- **An IR-level cost model.** Not tried; the launch rule is two thresholds read from measurements.
- **Framework legality hook.** Worked; it is the one framework change.

## Framework and tool changes

1. **`PassSpec.legal` and `PassError('illegal')`** (`src/framework/passes/define-pass.ts`; test in `tests/framework/native-pass-sync.test.mjs`). `applyPass` and `applyNativePassSync` call `legal({ before, view, params })` before `run`; a refusal throws `PassError('illegal', reason)` and runs nothing. *Reason:* the brief asks for each step's legality decided from the IR before it is applied. Without the hook a pass could only throw from `run`, which the caller cannot tell apart from a bug or a rejected contract; the strategy needs exactly that distinction to skip a step that does not apply (`isolate` on matmul, `contraction` on a pointwise kernel without a contraction) while still failing on anything else.

No change to `tools/cuda-remote.mjs`.

**Findings, not changed:**

- **`src/framework/strategy` is asynchronous only** and `cudaSource` is synchronous, so the strategy is a TypeScript function (above). Proposed: `executeSync` for plans of synchronous algorithms.
- **`applyNativePassSync` rejects `preserves`** ("This pass requires the asynchronous analysis manager"), so the order analysis cannot be declared as a preserved v6 analysis on a synchronous pass. It is the application's gate instead, which the function already takes. A synchronous preservation check by recomputation (the second half of what `applyPass` does) would let a pass declare it.
- **The framework's per-step cost** dominates scheduling: about 10 ms per application on a schedule of 9 KB (projection, diff, correspondence, `immutable` and fingerprints), 53 applications per contraction kernel. A function's schedule is memoized, so it is paid once per function.
- **Passes between IR kinds.** Tix to schedule and schedule to CUDA are not passes (`definePass` has one IR); the first is a function (`initialSchedule`) and the second is inside `tensor.lower-cuda`, a transformation, as before. That fit; nothing needed changing.

## What the contract checks and what it costs

`checkLowering` runs `tensor.lower-cuda` (now through the schedule) under the exact relation. A program with contraction kernels runs **every sample in every mode**: each of the four variants forced (`--variant=N`), paired alternately with the two gate sides when the program also has a gated kernel. The case list's baseline key is the list of modes. With the recipe's small shapes (sizes 0 to 11) the tiled variants run almost entirely in tails and padding, which is what the padding argument needs checked.

| Program | Samples | Cases fused | Cases unfused | Pass applications | Scheduling ms (first) |
| --- | ---: | ---: | ---: | ---: | ---: |
| matmul | 36 | 144 | 36 | 53 | 631 |
| softmax | 32 | 64 | 32 | 0 | 3 |
| layernorm | 32 | 64 | 32 | 0 | 7 |
| attention | 40 | 160 | 40 | 107 | 2884 |
| mlp | 40 | 160 | 40 | 107 | 1271 |
| conv2d | 28 | 112 | 28 | 53 | 490 |

A case list is 4 times stage 3b's for a program with contraction kernels (2 times was 3b's for gated programs), from one compilation; each mode is one GPU batch, run in parallel. `checkLowering` took 7 to 12 s of wall time per corpus program fused (script 02, binary in the remote build cache: mostly ssh and process start), against 5 to 12 s unfused. Scheduling (first call per function) is the CPU time in the last column, on this shared machine.

## Measured, and only argued

**Measured on the GB10:** every number in the tables; exact acceptance of the six corpus programs fused and unfused (script 02), of six feature programs with every variant forced (a batched product, a transposed operand with an epilogue, a pointwise member after the contraction, a 2-axis reduction with shifted reads, a contraction reading a row kernel's output in its epilogue, two chained contractions), and of attention and mlp after inline + split-sum (`schedule-gpu.test.mjs`); runs at shapes the rule tiles, including a single and a two-term reduction, a one-row product and a batched product, equal to the interpreter; two printer mutants rejected with a variant and a coordinate; bit-identical outputs of every variant and side at every benchmarked shape.

**Argued, not measured:** that the padding never changes a bit (above; the GPU cases exercise it); that the per-dim simulation covers every output's order for every extent (the argument is the mixed-radix enumeration and the per-output accumulator; the simulation is at three extent sets); that the printer prints what the nest says (only the GPU check covers it); the rule's behaviour between measured thresholds.

## Later

- `executeSync` in `src/framework/strategy`, and the strategy as a plan.
- A general loop-nest printer, so that intermediate schedules run and every step can also be checked on the GPU.
- Vector loads from global memory and double buffering, as variant axes or `stage` parameters.
- Tiling inside block groups (attention without the round trip of `score` and `weight` through global memory).
- A cost model in place of the two thresholds; split-K and tensor cores as passes that the order analysis would mark (they change `r`'s order by design and need a new relation).
