---
Title: Checked statement fusion for the Tix CUDA lowering
Ticket: IRWB-029-F
Status: active
Topics:
    - compiler
    - ir
    - verification
    - cuda
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-source.ts
      Note: Stage 2 emitter; gains the fused group kernels behind the fuse option
    - Path: repo://src/tensor/fusion.ts
      Note: New pure fusion planner deciding legality from the Tix IR
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Exact-relation differential check, threaded with the fuse option
    - Path: repo://src/tensor/index.ts
      Note: Public API gains fuse and benchmark options
    - Path: repo://src/tensor/model.ts
      Note: Affine, axis and expression record the planner reads
ExternalSources: []
Summary: A pure fusion planner on the Tix IR feeds group kernels (block per row with shared staging, or a per-element register chain) into the stage 2 emitter; the exact GPU relation re-checks the result.
LastUpdated: 2026-11-26T18:30:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked statement fusion for the Tix CUDA lowering

## Domain and API

Fuse statements of the selected function's **current revision** into fewer CUDA kernels without changing any result bit. Inputs, shapes and the calling domain are stage 2's. `cudaSource`, `runTixCuda` and `checkLowering` gain `options.fuse` (default `true`; `false` is the unchanged stage 2 lowering, one kernel per statement). `runTixCuda` gains `options.benchmark`, already implemented by `runCudaBatch`: one warm-up launch, then the median of three CUDA-event intervals, under the tool's `--timed` lock. `gpuMs` keeps its meaning: the function's kernels on one stream, without transfers and start-up. The kernel count of a lowering is the number of `__global__` definitions in `cudaSource`. Every other export keeps its signature and behavior.

## Where fusion lives, and why

**A pure planner on the Tix IR plus the emitter.** `src/tensor/fusion.ts` computes, from the resolved function alone, an ordered list of segments: single statements (stage 2 kernel) and fused groups. `cuda-source.ts` emits one kernel per segment. Legality is therefore decided from the Tix IR, before emission applies anything, and a fusion that cannot be shown to keep each output element's evaluation order is never planned.

- **Not a pass on the Tix IR.** A fused group is not a Tix statement: one kernel computes several tensors of different shapes, while a Tix statement defines exactly one tensor with one shape. Expressing a group would need a multi-output statement form, a new artifact schema, and a new meaning for the stage 1 contract — for no framework gain. Also `cudaSource` and `checkLowering` are pure functions of the program; a pass would advance revisions as a side effect.
- **Not a second v6 artifact (a kernel IR).** Stage 2 already argued this: a kernel IR restates statement, axis and expression data and adds a validator and a second emitter. The fusion plan is a deterministic function of the current revision, so it needs no revision identity of its own; the fused translation unit is already carried by the versioned CUDA source artifact, whose content hash distinguishes fused from unfused candidates. The exact-relation differential check judges the fused lowering end to end on the GPU, which is the guarantee the stage is asked to produce.

**Correspondence finding.** The framework's correspondence does not need to express "many statements become one kernel" here, because the checked transformation is artifact-level: one Tix IR artifact in, one CUDA source artifact out, exactly as in stage 2. Which statements a kernel computes is recoverable from the plan (a pure function of the input revision) and observable as the `__global__` count. Giving the CUDA artifact internal kernel entities and an entity correspondence would add ceremony no current contract consumes; it is recorded as a deliberate non-change, not forced work.

## What the planner may fuse

Statements are in definition order, which is a topological order (a statement reads only parameters and earlier statements). Groups are **intervals of consecutive statements** with at least two members. Greedy growth: extend the current group while the next statement is admissible; a statement that is not closes the group.

A group has a **row dimension** `D`: an affine shape expression. Statement `s` (with row binder `b`, its first axis) is admissible into a group with row dimension `D` when:

1. `s.axes[0].extent` is `{kind:'dim', dim: D}` (canonical equality). The row axis must be the leading axis, so every group tensor's row slice is contiguous. `s.shape[0] = D` follows.
2. Every load `T[f_0..f_{k-1}]` in `s` (including inside reductions) is one of:
   - **row-local**: `f_0` is exactly the plain binder `b`, all other `f_i` have zero coefficient on `b`, and `T.shape[0] = D`; or
   - **row-free**: every `f_i` has zero coefficient on `b` — and then `T` must be produced **outside the group** (a parameter or an earlier statement), because a row-free read of a group tensor reads other rows.
3. Any other involvement of `b` in an address (an offset like `i+1`, a coefficient other than 1, a transpose with the row extent at another position) refuses the statement, and with it the fusion.

These conditions are exactly what lets one block own one row: no group statement's element ever needs a value from another row of a group tensor, and every address it does need is either its own row's slice or a global tensor.

**Two thread mappings, chosen per group.** The mapping may change only where fusion needs it; every reduction still accumulates sequentially, in the meaning's order:

- **Row groups** (the general case): **one warp per row**. Each warp stages its own row slice in its own slice of the static shared array (out-of-group row-local tensors by one cooperative coalesced copy at kernel start; in-group statements by writing their computed slice to the stage, and to global when the statement also has consumers outside the group, including the function result). Statements run in definition order with `__syncwarp()` between them — the row guard is warp-uniform, so all participating lanes reach every barrier; `__syncwarp` orders the warp's shared and global accesses. Each slice element is computed by one lane with the stage 2 expression walker: same tree, same rounding sites, same sequential reduction loops. The host picks the block's warp count so every warp's slice fits the stage. *As built after measurement:* the first implementation used one block per row, and the fused softmax ran 2× slower than stage 2 (1.60 ms against 0.81 ms) — the row's serial reduction chain ran on one thread while 255 threads idled, and 48 KB of shared per block throttled the number of rows in flight. One warp per row carries several independent chains per block, and the shared capacity, not the warp count, bounds the rows in flight.
- **Register chains**: when every statement in the group has the same shape after the row axis and every in-group read is elementwise at the reader's own coordinates, one thread per output element — stage 2's own mapping — computes the whole chain, passing producer values through registers. Reductions are allowed: each element runs its own loops, exactly as in the stage 2 kernel. No staging, no synchronization. This covers elementwise chains of any rank and pointwise epilogues over contractions (mlp's bias and GELU behind its dense layer).

**Contractions keep the per-element mapping.** A statement containing a reduction whose body loads a row-free tensor (a matrix operand read like `w[d,j]` inside the dot) may *start* a group — a pointwise epilogue chains behind it — but never *joins* one. This is a performance rule, not a legality rule, and it is measured: fusing mlp's second contraction into its row group serialized a 1024-long dot into each lane and ran 2.5× slower than stage 2 (2.40 ms against 0.94 ms); the same shape appears in attention's output contraction. The rule is IR-decidable and recorded as a refusal with its reason, so the refused fusion is visible in the plan.

**Shared staging budget.** The stage is a static `__shared__` array of 12,288 floats (48 KB, the largest static per-block shared allocation CUDA guarantees without opt-in). The need is computed in-kernel from the shape values. Every corpus group fits by a wide margin (largest is attention at 3,136 floats). If a launch's need exceeds the cap, the kernel stages in the statement's own global buffer instead (written once, read after `__syncthreads()` — same values, same order, one kernel still). This keeps one `__global__` per group at any size, instead of emitting fallback kernels that would double the kernel count; the fused kernel then behaves like stage 2 with fewer launches.

**What is refused.** Single-statement programs (matmul, conv2d) fuse nothing: a group needs two statements, and changing a lone statement's mapping has no fusion to justify it. A contraction over a row-free operand is refused from joining a group for the measured reason above. The planner reports each refusal with its reason (row offset in an address, row-free read of a group tensor, row axis not leading, row dimension mismatch, contraction), and refusals are exercised by tests.

## Exactness

The fused kernel reuses the stage 2 scalar walker unchanged: the same intrinsics, literal words, shape-value conversions, reduction loop nests and fold order. Staging and register forwarding only change **where** a computed f32 word is read from, never **which** words are computed or in what order: every producer element is written before any consumer reads it (definition order plus `__syncthreads()`), and each output element's evaluation is one thread's sequential walk of the same tree. So the fused lowering is bit-identical to stage 2 by construction, and the contract re-checks it empirically.

`checkLowering(program, fn, {fuse})` emits the fused (or unfused) translation unit through the same checked transformation and invariant as stage 2: the exact relation against the current revision's f32 meaning, NaN as a class, over the stage 1 deterministic sample recipes (distinct sizes per shape symbol, empty extents, signed/positive/half-ULP/zero streams). The subject artifact's content hash distinguishes fused from unfused candidates, so evidence reuse and the in-flight batch sharing are unaffected. No framework or tool source changes are required: `runCudaBatch` already implements `benchmark`, and the remote tool's `--timed` lock, per-key compile cache and `--` program arguments already serve it.

**Framework change ledger: none required.** The candidates considered: a kernel IR artifact and entity correspondence (rejected above); a multi-output Tix statement (rejected above); exposing `runCudaBatch`'s benchmark path (a one-line option pass-through in `src/tensor`, not a framework change). Each fusion-shape decision is recorded in the report with the measurements.

## Verification and measurement

- Local (no GPU) tests: planner grouping and refusals; kernel counts in emitted source; both mappings' source shape; stage 2 behavior under `fuse:false`; the benchmark option reaching the runner arguments.
- GB10 tests in `tests/tensor/cuda-gpu.test.mjs`: fused corpus runs bit-identical to `runTix` f32, `checkLowering` accepting fused corpus programs (original and optimized revisions) as `exact`, the shared-capacity fallback at a row larger than 12,288 elements, an elementwise chain, and rejection of a fused-source mutant.
- Measurements (ticket `scripts/`, each committed and numbered): for each corpus program at the brief's sizes, fused and unfused — kernel count, benchmark GPU time (`benchmark: true`), global-memory bytes per kernel by my analytic count over the plan, and that byte count's time at 244 GB/s. Also which fusions applied, which were refused and why, and the contract's cost per check.

## Later

- Splitting a row group's staging across per-tensor shared/global placement when one oversized tensor currently forces the whole group to global staging.
- Non-consecutive grouping (skipping an unfusable middle statement) and multi-group row axes.
- Reassociation of reductions, contraction tiling for data reuse, FMA contraction, tensor cores, streaming attention and autotuning — explicitly out of scope for this stage.
