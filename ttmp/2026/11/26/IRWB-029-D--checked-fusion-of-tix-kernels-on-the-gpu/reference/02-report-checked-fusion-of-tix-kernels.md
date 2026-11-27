---
Title: 'Report: checked fusion of Tix kernels'
Ticket: IRWB-029-D
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/fusion.ts
      Note: Legality analysis on the Tix IR (planFusion)
    - Path: repo://src/tensor/cuda-source.ts
      Note: Shared scalar writer, stage-2 kernel emitter and the group emitter
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Lowering transformation with the fuse port and the statements-to-kernels correspondence
    - Path: repo://tests/tensor/fusion-gpu.test.mjs
      Note: GB10 checks of fused lowerings, shared-memory limits and mutants
    - Path: repo://ttmp/2026/11/26/IRWB-029-D--checked-fusion-of-tix-kernels-on-the-gpu/scripts/04-benchmark.mjs
      Note: Full-size timings and output digests
ExternalSources: []
Summary: Fusion as a legality analysis on the Tix IR plus a group emitter; every corpus program one kernel, bit-identical; softmax 2.1x, layernorm 2.9x, attention 1.4x, mlp 1.3x faster than stage 2; no framework change, one finding about correspondence.
LastUpdated: 2026-11-27T01:30:00-05:00
WhatFor: Final report of stage 3 (IRWB-029-D)
WhenToUse: Reviewing what fusion does, what it costs, what was measured and what the framework could and could not express
---

# Report: checked fusion of Tix kernels

Stage 2 lowered each Tix statement to its own CUDA kernel, one thread per output element. Stage 3 merges statements into fewer kernels and must not change a single result bit. All six corpus programs now lower to one kernel each. The fused outputs are bit-identical to the f32 meaning, both on the contract's cases and at full size. Softmax runs 2.1 times faster than stage 2, layernorm 2.9, attention 1.4 and mlp 1.3. Matmul and conv2d have one statement each, so their lowering is unchanged. No framework source changed. The framework can express "four statements became one kernel" as a correspondence. It checks the record's revisions but not its entity IDs, and that is the stage's framework finding.

The code is at the last commit of branch `t3-op/irwb-029-d`. The measurements were taken at `0b217d3`, and later commits changed only kernel comments and tests (diary steps 7 and 8).

## Results

Kernel count is the number of `__global__` definitions in `cudaSource`. GPU time is `runTixCuda(..., { benchmark: true })`: one warm-up launch and the median of three CUDA-event intervals, under the runner's `--timed` lock. The table gives the median of three such runs per program (script 04, output in `scripts/04-benchmark-gpu.out.jsonl`), at the brief's sizes, on the GB10. Inputs are seed 20, f32 values in [−0.1, 0.1], and layernorm's eps = 1e-5.

| Program | Kernels fused / unfused | GPU ms fused (3 runs) | GPU ms unfused (3 runs) | Speed-up |
| --- | ---: | --- | --- | ---: |
| matmul, M = K = N = 512 | 1 / 1 | **0.213** (0.219, 0.211, 0.213) | 0.216 (0.216, 0.216, 0.207) | 1.0 |
| softmax, N = 4096, C = 1024 | 1 / 4 | **0.381** (0.386, 0.381, 0.381) | 0.809 (0.804, 0.815, 0.809) | 2.1 |
| layernorm, N = 4096, D = 1024 | 1 / 4 | **0.169** (0.171, 0.164, 0.169) | 0.491 (0.485, 0.496, 0.491) | 2.9 |
| attention, Q = K = 1024, D = V = 64 | 1 / 6 | **0.751** (0.751, 0.750, 0.753) | 1.048 (1.048, 1.045, 1.049) | 1.4 |
| mlp, N = 1024, D = 256, H = 1024, O = 256 | 1 / 3 | **0.725** (0.724, 0.725, 0.726) | 0.939 (0.950, 0.898, 0.939) | 1.3 |
| conv2d, N = 8, C = 16, H = W = 64, O = 32 | 1 / 1 | **0.165** (0.165, 0.166, 0.164) | 0.166 (0.166, 0.165, 0.166) | 1.0 |

In all three rounds the fused and unfused outputs had the same SHA-256 for every program. The f32 interpreter (`runTix`) produced the same digest for all six programs at these sizes (`scripts/04-benchmark-cpu.out.jsonl`). So at full size the fused results equal the meaning bit for bit, and so do the unfused ones.

## Where fusion lives, and why

Fusion is a **legality analysis on the Tix IR**, `planFusion(fn)` in `src/tensor/fusion.ts`, whose result the **emitter applies**. The plan is a list of groups. Each group gives its statements, its block depth, its mapping, and the statements it stores, buffers and stages, with reasons. The lowering records the plan in the CUDA artifact and returns a correspondence from Tix statements to kernels.

- **A pass on the Tix IR** would be the simplest place, because the pass machinery and the meaning gate already exist. But Tix's meaning materializes every statement. The only way to merge two statements in Tix is to inline one into the other, and inlining a reduction recomputes it once per consumer element. Inlining softmax's `m[i]` into `e[i,j]` would do C times the max work. What fusion changes is where an intermediate lives and which threads compute a row, and Tix cannot say either.
- **A second v6 artifact (a kernel IR)** would contain the plan plus a copy of the Tix function. Nothing edits it between planning and emission, and its meaning is the Tix meaning. It would need an IR definition, a validator and an adapter, and nothing would consume them. A kernel IR becomes worthwhile when a later stage rewrites schedules with checked passes (Later).
- **The analysis plus the emitter (chosen).** The plan is decided from the Tix IR before any code exists. The emitter only follows it, and the GPU check judges the result end to end.

## The legality rule

Groups are contiguous runs of statements. A group has a block depth k ≥ 1: its members share their first k axes, which have equal affine extents and form the block domain. Statement s joins the current group when both of these hold:

1. s reads at least one member of the group.
2. Some k' ≥ 1 exists such that s's first k' extents equal the group's, and every read of a member inside s, including reads inside reductions, has exactly s's own axis at each position p < k'. The new depth is the largest such k' ≤ min(k, rank s).

Then every block-domain point needs only its own slice of each member, and the members can be computed in order, point by point. Both conditions keep holding when k gets smaller, so narrowing the depth when s joins keeps the earlier members legal. A non-member tensor is staged (its row copied into the block's row buffer) when a member reads it at the block indices and its leading extents equal the block domain's. The checker unifies extents only for plain occurrences in the source: `t[i+0,k]` is plain in the IR without the checker having unified its extent. So staging compares the extents itself (`fusion.test.mjs` tests this).

**Applied on the corpus.** No refusals, and one kernel per program.

| Program | Kernel | Mapping, block domain | Thread 0 computes | Staged | Buffered | Stored |
| --- | --- | --- | --- | --- | --- | --- |
| matmul | y | thread, [M, N] (stage 2) | | | | y |
| softmax | m, e, s, y | block, [N] | m, s | x | m, e, s | y |
| layernorm | mean, centered, variance, y | block, [N] | mean, variance | x | mean, centered, variance | y |
| attention | score, shift, e, z, weight, out | block, [Q] | shift, z | q | score, shift, e, z, weight | out |
| mlp | h, g, y | block, [N] (y narrows it: its axis 1 has extent O, the kernel's H) | | x | h, g | y |
| conv2d | out | thread, [N, O, H−2, W−2] (stage 2) | | | | out |

The brief's three categories all appear. Elementwise chains and epilogues run in thread mode: `fusion.test.mjs` checks an `exp`-multiply-add chain and a matmul followed by bias and tanh, and `fusion-gpu.test.mjs` runs them on the GPU. Row reductions together with their producers and consumers run in block mode: softmax and layernorm. In attention and mlp, a contraction joins too, because a later reduction reads its whole row. For mlp I measured the alternative plan with the epilogue only (h and g in one thread-mode kernel, y in a second). It took 0.858 ms against 0.812 ms for the single kernel, with the same output (script 08, cap 128), so the planner keeps fusing the contraction's consumer.

**Refused by the rule, with the reason recorded** in `plan.refusals` (tested in `fusion.test.mjs`):

- a read of a member at another row, such as `b[i,j] = a[j,i]` ("reads a at index … in position 0, not its own axis there"), or at a shifted leading index;
- different leading extents, such as `b[j] = sum(i) a[i,j]` with `a: [N,M]` ("its axis 0 has extent M, the kernel's N");
- a statement that reads no member ("no horizontal fusion").

**Legal-looking fusions I refused, and why:**

- **A parallel tree max.** Tix's max is order-independent bit for bit: NaN propagates, +0 ranks above −0, and probe 07 found no differing pair. A tree max would therefore pass the exact check. The brief requires every reduction to accumulate sequentially, so each max stays a sequential fold by one thread.
- **Staging attention's `k` in shared memory.** `score[i,j]` reads `k[j,d]` with `j` varying across threads, so each warp load touches 32 cache lines. Transposed tiles of `k` would fix this, but that is tiling a contraction, which belongs to a later stage.
- **Recomputation and horizontal fusion.** Inlining a reduction into its consumers changes the amount of work. Fusing statements that do not read each other is not one of the brief's categories, and it would push thread-mode statements into block mode.
- **Reordering statements** to make non-adjacent producers and consumers contiguous.

## The two mappings and what changed in the thread mapping

- **Thread mode** (every member has rank k) keeps stage 2's mapping: one thread per element and 256 threads per block. The members run in order in the same thread, and a member read at its own indices is the register that holds its value. A one-statement group goes through stage 2's own emitter, so its source is byte-identical to stage 2's.
- **Block mode** (some member has more axes than k) uses one block per block-domain point. Each kernel in this mode changes the thread mapping as follows:
  - **One block per row instead of one thread per element.** A later member reads the whole row of an earlier one, so the row must be complete inside the block before anyone reads it. Element e of a member's row is computed by thread e mod blockDim, so global stores stay coalesced.
  - **Thread 0 computes each row-scalar member** (`m`, `s`, `mean`, `variance`, `shift`, `z`), with its reduction in the meaning's order. Stage 2 gave each row its own thread across the grid. In the fused kernel, a row-scalar has one element per block.
  - **Staged rows** (x for softmax, layernorm and mlp; q for attention) are copied with coalesced loads before the members run. Stage 2's row kernels read them with one thread per row, uncoalesced.
  - **`__syncthreads()`** separates the staging from the members and each member from the next.
  - **The rows live in dynamic shared memory** when they fit under the opt-in limit queried at run time (99 KiB on the GB10, probe 01). Otherwise they go to a global scratch area, one row set per block. The kernel is `template <bool Shared>`, so shared rows are addressed as shared memory. A generic pointer cost 25% on a row max (script 06). The host launches `k<true>` or `k<false>` and opts in above 48 KiB. One kernel definition covers both cases. `fusion-gpu.test.mjs` runs rows of 64,000 bytes (opt-in) and 240,000 bytes (scratch) against the interpreter.
  - **Threads per block** are the smallest warp multiple that covers the longest row, capped at 128. The cap is 64 when a member's reduction reads a tensor from global memory: attention's `k` and `v`, mlp's `w` and `v`. I measured caps of 64, 128 and 256, twice for 64 and 128 (diary step 4). Rows-only kernels are fastest at 128 (softmax 0.387 against 0.494 at 64), and contraction kernels at 64 (mlp 0.727 against 0.881 at 128). Occupancy does not explain the split. I suspect L1 contention from the operands streamed out of L2, but I have not verified it.
- **One primitive differs between fused and unfused kernels: the max fold.** Fused kernels fold max with PTX `max.NaN.f32` instead of the emitter's `minmax(a, b, true)`. Probe 07 found the two equal on all 324 pairs of 18 words: zeros of both signs, ±1, ±∞, quiet and signalling NaNs of both signs, subnormals, ±FLT_MAX, 1 + ulp and π. NaN results were compared as a class. The reason is the mapping change. Shared memory limits a block-mode kernel to about 12 resident rows per SM, where stage 2 ran about 85 row threads per SM, so the fold's latency becomes the critical path. A row-max kernel took 0.32 ms with `minmax` and 0.15 ms with `max.NaN.f32` (script 06). The PTX definition (the larger operand; canonical NaN if either operand is NaN; −0 below +0) matches what the probe observed. The probe is not exhaustive over pairs.

### Why the bits do not change (argued)

Every element of every statement is computed by one thread, running the scalar code stage 2 emits for it. The code is produced by the same `kernelWriter` tree walk, with the same explicit round-to-nearest intrinsics, double `exp`/`log`/`tanh` rounded once, and the same loop order. Only the max fold's instruction differs, as described above. Each value a thread reads equals the meaning's value:

- parameters and earlier kernels' outputs, as in stage 2;
- a member, from a register written earlier by the same thread, or from a row buffer written by a thread of the same block before a barrier, at the row the legality rule guarantees;
- a staged value, as a bit copy.

Loads, stores and copies move f32 words unchanged. A block's global writes are visible to the whole block after `__syncthreads()`, which covers the scratch case.

## Bytes per kernel (argued, by count)

The count includes each distinct tensor a kernel reads from global memory (a parameter or an earlier kernel's output), once at full size, plus each tensor it stores. This is compulsory traffic with perfect caching: repeated reads by many blocks are assumed to hit in the 24 MiB L2. Times are these bytes at 244 GB/s (script 10).

| Program | Lowering | Kernel | Reads (MiB) | Writes (MiB) | ms at 244 GB/s |
| --- | --- | --- | ---: | ---: | ---: |
| matmul | both | y | 2.00 (a, b) | 1.00 | 0.0129 |
| softmax | fused | m, e, s, y | 16.00 (x) | 16.00 | **0.1375** |
| softmax | unfused | m / e / s / y | 16.00 / 16.02 / 16.00 / 16.02 | 0.02 / 16.00 / 0.02 / 16.00 | 0.0688 / 0.1376 / 0.0688 / 0.1376 = **0.4128** |
| layernorm | fused | mean, centered, variance, y | 16.01 (x, eps, gamma, beta) | 16.00 | **0.1376** |
| layernorm | unfused | mean / centered / variance / y | 16.00 / 16.02 / 16.00 / 16.02 | 0.02 / 16.00 / 0.02 / 16.00 | 0.0688 / 0.1376 / 0.0688 / 0.1376 = **0.4129** |
| attention | fused | score … out | 0.75 (q, k, v) | 0.25 | **0.0043** |
| attention | unfused | score / shift / e / z / weight / out | 0.50 / 4.00 / 4.00 / 4.00 / 4.00 / 4.25 | 4.00 / 0.00 / 4.00 / 0.00 / 4.00 / 0.25 | 0.0193 / 0.0172 / 0.0344 / 0.0172 / 0.0344 / 0.0193 = **0.1419** |
| mlp | fused | h, g, y | 3.00 (x, w, bias, v, outBias) | 1.00 | **0.0172** |
| mlp | unfused | h / g / y | 2.00 / 4.00 / 5.00 | 4.00 / 4.00 / 1.00 | 0.0258 / 0.0344 / 0.0258 = **0.0860** |
| conv2d | both | out | 2.02 (x, kernel) | 3.75 | 0.0248 |

Comparing measured with counted:

- **Layernorm** runs at 1.23 times its streaming time (0.169 against 0.138 ms).
- **Softmax** runs at 2.8 times its streaming time. Its 4M double `exp` calls bound it: a kernel computing only `y = exp(x)` at the same size takes 0.368 ms, measured (script 05).
- **Attention and mlp** are far from their counts. Each block re-reads `k`, `v`, `w` and `v` from L2, which is roughly 1,000 times the counted bytes, and only contraction tiling changes that.

## Framework and tool changes

**None to `src/framework/` or `tools/cuda-remote.mjs`.** The framework already provided everything the fused lowering needed:

- a transformation from an IR input of one kind to an IR output of another;
- a typed scalar input (the new boolean `fuse` port, `tensor.fuse`);
- a required correspondence between those two ports;
- a differential memo that keys evidence by subject revision, so fused and unfused lowerings get separate evidence while sharing one case set and one set of reference values. `fusion.test.mjs` checks that the two batches have the same size.

`runCudaBatch` already supported `benchmark`.

The tensor domain changed in four places:

- `CudaIR` is at version 2 and records `kernels: { name, mapping, statements }[]`.
- `tensor.lower-cuda` is at version 2: it has the `fuse` port and requires the `kernels` correspondence with relation `statements-to-kernels`.
- `cudaArtifact(fn, source, kernels = [])`.
- `createCudaLowering(...)` returns `(baseline, fn, candidate?, { fuse, manager }?)`.

**Finding: the correspondence expresses the merge, but nothing checks its entity IDs.** For softmax the record is `{ from: ['softmax/m', 'softmax/e', 'softmax/s', 'softmax/y'], to: ['k0'] }`. The manager checks that it names the exact input and output revisions and the declared relation (`fusion.test.mjs`). Probe 12 sent three candidates through the same transformation: one with a kernel list naming `softmax/nonexistent` → `k7`, one with no kernels at all, and one as planned. All three passed the correspondence check ("Exact input/output revisions and relation match"). A `defineIR` artifact has no entity projection, so the manager has nothing to check the IDs against. The IR layer's `makeCorrespondence` does check against explicit entity universes, but the contracts layer does not use it.

**Proposed change (not made; nothing in this stage depends on it):** an optional `entities(value): Iterable<string>` on `defineIR`. When both ports' types provide it, `AnalysisManager.validateCorrespondence` would reject IDs outside the two artifacts' universes. TixIR would supply its adapter's tensor IDs and CudaIR its kernel names. That check would catch the invented IDs above. It would not check that kernel k0 really computes m, e, s and y; the GPU differential does that.

One framework rule did block a first attempt, and it is correct as designed. An invariant must bind every port it declares, and spreading the transformation's inputs, including the new `fuse` port, into the invariant's ports failed with `Missing invariant binding fuse` (diary step 2).

## What the contract checks and what it costs

`checkLowering(program, fn, { fuse })` runs `tensor.lower-cuda` through `AnalysisManager.execute`. The body plans the function (when fusing), emits the source, and returns the CUDA artifact and the correspondence. The `ensures` invariant `tensor.cuda-meaning` (version 2, unchanged from stage 2) compares every case's GPU output with the current revision's f32 meaning, word for word, with NaN compared as a class. The case recipe is stage 2's `cudaCases`:

- shape assignments: all symbols set to 1, 3, 4 or 7, a mixed assignment that gives every symbol a distinct size, all zeros, and one zero at a time;
- four input streams per assignment: signed, positive, half-ulp and signed zero;
- limits of at most 4,096 elements per tensor and 10^6 evaluator steps per case.

The cases are small, so they exercise block mode with short rows, zero extents and empty grids, but not the scratch fallback. The GPU tests cover the fallback separately.

Cost per corpus program, fused (script 11):

| Program | Cases (shape assignments × 4 streams) | Elements in and out | Build cases locally | Cold batch: nvcc / run on GB10 / wall | `checkLowering` | Repeat (memo) |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| matmul | 36 (9) | 1,292 | 3 ms | 0.88 s / 0.29 s / 3.1 s | 2.2 s | 2 ms |
| softmax | 32 (8) | 720 | 2 ms | 0.94 s / 0.39 s / 3.3 s | 2.9 s | 1 ms |
| layernorm | 32 (8) | 920 | 2 ms | 0.92 s / 0.29 s / 3.1 s | 2.2 s | 1 ms |
| attention | 40 (10) | 1,728 | 12 ms | 1.03 s / 0.56 s / 3.5 s | 2.2 s | 1 ms |
| mlp | 40 (10) | 1,948 | 6 ms | 1.05 s / 0.30 s / 3.6 s | 2.6 s | 1 ms |
| conv2d | 28 (7) | 22,900 | 242 ms | 0.91 s / 0.29 s / 3.6 s | 3.7 s | 1 ms |

The run time is mostly process start and CUDA initialization. Wall time is dominated by ssh and compilation. A check costs about as much as stage 2's, because the fused source is no larger to compile and the cases are the same.

## Measured, and only argued

**Measured on the GB10 or locally:**

- **Kernel counts and GPU times:** three rounds; fused and unfused outputs identical at full size in every round.
- **Full-size outputs:** equal to the interpreter for all six programs.
- **Exact acceptance:**
  - all 24 corpus checks: fused and unfused, original and inline + split-sum;
  - nine hand-written feature programs: a stencil with a 2-axis block domain, a 3-axis softmax, nested shadowed sums, a middle member that is both stored and buffered, shifted trailing reads, a matmul epilogue, a returned middle member, a fused group whose results are all dead, and an affine block domain;
  - 40 random lowerings (20 programs, before and after inline + split-sum). 19 have a multi-statement kernel, 14 a block-mode one, and 116 statements became 88 kernels.
- **Rejections:** two deterministic mutants of a fused row-sum kernel (a reversed sum loop, a staging copy of the wrong row), each with a coordinate.
- **Shared-memory limits:** the opt-in and scratch rows equal the interpreter.
- **Probes:** device limits, the `max.NaN.f32` pairs, the cost breakdown (scripts 05, 06 and 08), the thread caps, the contract cost, and the correspondence probe.

**Argued, not measured:**

- that fusion keeps the bits for every program in the domain (the construction above; the measurements are samples);
- the bytes per kernel and their times at 244 GB/s (a count, not a profiler measurement);
- `max.NaN.f32` agreeing with `minmax` beyond the probed classes (the PTX definition);
- the L1-contention explanation for the 64-thread cap.

## Later

- A kernel IR artifact, once schedules are rewritten by checked passes (tiling, tensor cores).
- Entity universes on `defineIR`, so the manager can check correspondence IDs (proposal above).
- An exact and cheaper f32 `exp`: 4M double `exp` calls cost 0.37 ms, which is softmax's floor here. Any replacement must match V8 for all 2^32 inputs.
- A run-time choice between block and thread mode when there are few, long rows. With one row of 10^6 elements, a single block does the whole parallel phase.
- Reusing dead row buffers, such as attention's `score` once `e` exists, to raise occupancy; several rows per block; horizontal fusion; statement reordering.
- Vector loads of contraction operands, and transposed tiles of `k` (contraction tiling, later stage).
- A parallel max (exact, but outside this stage's sequential rule).
