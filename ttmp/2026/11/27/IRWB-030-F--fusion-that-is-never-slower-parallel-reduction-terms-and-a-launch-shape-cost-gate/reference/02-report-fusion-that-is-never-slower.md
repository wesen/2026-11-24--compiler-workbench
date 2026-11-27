---
Title: 'Report: fusion that is never slower'
Ticket: IRWB-030-F
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
      Note: Staged reductions in the plan, the measured cost gate and the thread caps
    - Path: repo://src/tensor/cuda-source.ts
      Note: Fill-and-fold emitter for staged reductions, template on Shared and Staged
    - Path: repo://src/tensor/index.ts
      Note: runTixCuda lowers through the gated plan from the input shapes
    - Path: repo://tests/tensor/staging-gpu.test.mjs
      Note: GB10 checks of staged, serial-fallback, scratch and gated lowerings
    - Path: repo://ttmp/2026/11/27/IRWB-030-F--fusion-that-is-never-slower-parallel-reduction-terms-and-a-launch-shape-cost-gate/scripts/04-benchmark.mjs
      Note: The report's benchmark table
ExternalSources: []
Summary: "Stage 3b: a row reduction's terms are computed in parallel and folded in order (bit-identical), and a measured launch-shape gate keeps a group unfused when fusing would be slower. layernorm-inside fused 0.202 ms against 0.545 unfused (stage 3: 0.569 against 0.577); every corpus program fused is faster than unfused. No framework change was needed."
LastUpdated: 2026-11-27T05:30:00-05:00
WhatFor: Final report of stage 3b (IRWB-030-F)
WhenToUse: Reviewing what parallel terms and the cost gate do, what was refused, what was measured and what the framework could express
---

# Report: fusion that is never slower

Stage 3 fused every legal producer-consumer chain, but in block mode a row-scalar member's reduction ran its
whole body serially on thread 0 of the row's block; on the "inside" division placements that cost up to 3x
and left the fused margin over stage 2 inside run-to-run noise. Stage 3b takes that concurrency back and
adds a decision that keeps a group unfused when fusing would be slower:

- **Parallel terms, serial fold.** In this IR a reduction's body cannot mention the accumulator, so every
  term is a pure function of loads. The block's threads compute the terms of a row-scalar member's outermost
  reductions into a shared term buffer (each thread a strided share of a flat index that enumerates the
  meaning's lexicographic order), and thread 0 folds the buffer in order - the same additions, on the same
  accumulator chain, on values computed by the same scalar code. The result is bit-identical by construction.
- **A measured cost gate.** `gatedPlan(fn, shapeValues)` replaces a block-mode group with stage 2's
  per-statement kernels when its fused parallelism would leave the GPU unsaturated and the unfused mapping
  would not.

Every corpus program and both inside variants now lower fused to **one kernel, bit-identical to the f32
meaning, and faster than `fuse: false`**. The headline: layernorm-inside fused is 0.202 ms against 0.545
unfused, where stage 3 measured 0.569 against 0.577. No framework source changed; the candidate path of the
existing transformation is what checks a gated source.

The code is on branch `t3b-g-h-irwb-030-f`, last commit at the time of this report.

## Results

Kernel count is `__global__` definitions in `cudaSource` (the ungated plan). GPU time is
`runTixCuda(..., { benchmark: true })`: one warm-up launch and the median of three CUDA-event intervals;
the table gives the median of three such calls (spread in `scripts/04-benchmark.out`, all within about 2%).
Sizes as in the brief. Inputs: seed 20, values in [-0.1, 0.1], layernorm's eps = 1e-5. Fused and unfused
outputs had equal SHA-256 in every round.

| Program | Kernels fused / unfused | GPU ms fused | GPU ms unfused | Speed-up | Parallel terms |
| --- | ---: | ---: | ---: | ---: | --- |
| matmul, M = K = N = 512 | 1 / 1 | **0.214** | 0.219 | 1.0 | (thread mode) |
| softmax, N = 4096, C = 1024 | 1 / 4 | **0.382** | 0.812 | 2.1 | none (m, s refused: bare loads) |
| layernorm, N = 4096, D = 1024 | 1 / 4 | **0.186** | 0.469 | 2.5 | variance: sum(D) |
| layernorm-inside, N = 4096, D = 1024 | 1 / 4 | **0.202** | 0.545 | 2.7 | mean: sum(D), variance: sum(D) |
| attention, Q = K = 1024, D = V = 64 | 1 / 6 | **0.754** | 1.052 | 1.4 | none (shift, z refused: bare loads) |
| attention-inside, Q = K = 1024, D = V = 64 | 1 / 5 | **1.412** | 1.470 | 1.04 | none (l refused: bare load) |
| mlp, N = 1024, D = 256, H = 1024, O = 256 | 1 / 3 | **0.726** | 0.944 | 1.3 | none (no row-scalar members) |
| conv2d, N = 8, C = 16, H = W = 64, O = 32 | 1 / 1 | **0.166** | 0.166 | 1.0 | (thread mode) |

Against stage 3's measurements (same sizes, different session; the brief reports up to 5% between
sessions): layernorm-inside improved from 0.569 to 0.202 ms fused - the 2.4x that parallel terms buy on a
division per term - and layernorm from 0.191 to 0.186. The programs whose reductions are all refused
(softmax, attention, attention-inside, mlp) are unchanged in structure and within session noise of stage 3's
numbers. Attention-inside's margin over unfused is the thinnest (4% this session, 6% in the brief's
measurements); its fused kernel is byte-for-byte stage 3's structure (no staged reduction, single `Shared`
template), so this stage did not change it.

Matmul and conv2d are single statements; their lowering is stage 2's, one kernel either way.

## How terms are staged

`planFusion` (unchanged in its legality rule) now records, per block-mode group, the **outermost reductions
of row-scalar members** (rank == depth - the members whose reductions ran on thread 0) as `parallelTerms`,
with the child-index path to each reduce node, and records every refusal in the group's reasons, which the
emitter prints in the kernel comment. The emitter (`emitGroup` in `cuda-source.ts`):

- declares, per staged reduction, its term count (the product of its axes' extents; a `blocks` extent is a
  constant count) and a pointer into one shared **term region** that all members reuse in turn (members are
  barrier-separated; the region holds the largest one-member sum);
- emits a fill loop `for (f = threadIdx.x; f < nterms; f += blockDim.x)`, decomposing the flat `f` into the
  reduction's axes in row-major order - which is the meaning's lexicographic order - and walking the body
  with the same scalar tree walk stage 2 uses (a nested reduction, such as a split sum's tail, runs serially
  inside its term);
- emits one `__syncthreads()`, then thread 0 computes the member, and the writer's new fold mode replaces
  the reduction with `acc = 0; for (t = 0; t < nterms; ++t) acc = __fadd_rn(acc, terms[t])` - or the PTX
  `max_nan` fold, in order, for max;
- guards fill and fold with `if constexpr (Staged)`, with stage 3's serial walk as the `else` branch. The
  group becomes `template <bool Shared, bool Staged>` only when something is staged; the host launches the
  instantiation whose rows **and** term buffers fit the opt-in shared-memory limit (99 KiB on the GB10),
  falling back to the serial fold when the term buffer does not - the same one-code-path choice stage 3
  made for shared rows against global scratch.

Why the bits do not change (argued, and checked below): each term is computed by one thread running the
same scalar code the serial loop would run for that iteration, with the same round-to-nearest intrinsics;
the buffer moves the values as bit copies; thread 0 performs the same folds, in the same order, on the same
accumulator chain. Zero-extent reductions fill and fold nothing and return the initializer, as before. The
one emitter bug this construction exposed - binder names derived from a map size, which collided when the
same expression was walked twice (the serial fallback read `4LL * i4 + i4`) - is fixed with a dedicated
counter; stage 2's kernels bind every axis exactly once in order, so their emitted bytes (and the
`fuse: false` digest test) are unchanged.

## The gate, and the measurements behind it

In block mode the row members run on `points x threads-per-block` threads, each computing
`row-length / threads` elements, where stage 2 runs `points x row-length` threads, one element each. When
the fused count already saturates the GPU, the total work decides and fusion also saves global traffic;
when it does not and the unfused count would saturate, fusion is slower. The gate compares, per block-mode
group, at the launch shape values:

**fuse iff** `points x threads >= 16384` **or** a row-scalar member's serial term count spans the longest
row **or** the row fits in its block's threads.

Measurements (scripts 02 and 03; each point one to three benchmark calls, fused = the ungated `cudaSource`
against `fuse: false`):

- **mlp** is the one family that crosses: 1.78 at 8,192 fused threads (N=128), 1.19 at 12,288 (N=192), 0.99
  at 16,384 (N=256), 0.77 at the corpus size (65,536). So 16,384 is the upper edge of the measured
  crossover band; below it the gate refuses. mlp is also the worst shape of the family: every row member is
  a contraction reading a strided global operand, and it has no row-scalar member at all.
- **softmax and layernorm-inside** (streaming row members, 16 MiB fixed) never cross: fused wins down to
  4 rows x 128 threads = 512 fused threads (0.45 to 0.90). Their row-scalar reductions span the row, and
  stage 2 pays the same serial fold on one thread per row - at few rows that thread is most of the unfused
  time. The second clause is that equalizer, stated from the IR and the shape values.
- **attention** never crosses: 0.45 at Q=32 (2,048 fused threads) to 0.71 at the corpus size.
- **The row-fits clause**: when the row is no longer than its block's threads, the fused kernel has at
  least as many threads on every phase as stage 2, so nothing is lost at any size.

Where the gate runs: `cudaSource` has no shape values and keeps stage 3's fully fused plan - it is what
`checkLowering` checks and what the kernel count counts. `runTixCuda` knows the launch shapes and lowers
through `gatedPlan`, so the program it runs is never slower than `fuse: false` at those shapes; at the
corpus sizes the gate passes and the run source equals `cudaSource`'s. A refused group emits stage 2's own
kernel per statement (the emitter's singleton path), and the gated source is checkable as a **candidate**
through the same transformation - the GPU test does exactly that and the exact contract accepts it.

What the gate costs (measured, accepted): below the threshold it forfeits wins - attention at Q=128 fuses
2.3x faster, but the gate refuses it because mlp at the same fused-thread count is 1.7x slower, and no
IR-visible feature separated the two in the sweeps (both have strided contraction operands). A
structure-aware two-threshold rule would need a crossover measured per structure, and only one family
crossed.

## Refused, and why

**Term stagings refused** (recorded in the plan's reasons, printed in the kernel comment):

- **Bare-load bodies** (`sum(j) e[i,j]`, `max(j) x[i,j]`, attention's `l`): the serial chain is the fold
  itself - shared-memory loads pipeline behind the dependent adds - so staging only adds a shared round
  trip and a barrier per term. **Measured**: the refused serial fold against the same reduction staged by
  a multiplication by 1 (exact for every f32 word, NaN as a class): 0.383 ms against 0.381 ms, ratio 0.996
  (script 06).
- **Nested reductions**: only the outermost reduction of a member is staged; the tail sum of a split stays
  serial within its term, because staging the leaves would reassociate the split sum and change the bits.
  A split sum's outer block reduction *is* staged (its terms are the inner sums; checked exact on the GB10).
- **A `tail` axis on an outermost reduction**: never produced by the checked passes (split-sum nests the
  tail inside the block reduction), and a flat term index cannot enumerate it in lexicographic order.
- **Row members** (rank > depth): their elements are already computed by different threads of the block,
  so a costly body is already concurrent; staging a row member's per-element reductions would need the
  whole row's terms in memory - 65,536 floats for attention's `score`, 256 KiB per row - landing in global
  scratch and adding more traffic than it saves. **Argued, not measured.**
- **Term buffers beyond the shared limit**: the host takes the serial-fold instantiation of the same kernel
  rather than pushing the terms to global scratch, which would add `2 x terms x 4` bytes of scratch traffic
  per block. **Argued** (the traffic count), with the fallback itself **checked exact** on the GB10 at
  60,000 terms.

**Fusions refused**: stage 3's legality refusals are unchanged (another row, other leading extents, no
member read). The gate additionally refuses block-mode groups below its threshold - in the corpus domain,
mlp-like programs at few rows (a group whose row members are all contractions and no row reduction spans a
row) and long-row elementwise groups (e.g. `t[i] = x[i,0] * 2; y[i,j] = t[i] + x[i,j]`) at few rows.
Thread-mode groups are never gated: their mapping is stage 2's with fewer launches.

## Thread caps

The contraction cap (64 when a member's reduction reads a global tensor) is stage 3's measurement and is
unchanged. The rows-only cap is re-measured with staging (script 06, three benchmark calls per cap):
**256** (layernorm 0.189 ms against 0.209 at 128; layernorm-inside 0.215 against 0.224; softmax 0.385
against 0.390), and 512 is worse again (0.253, 0.263, 0.380). Stage 3's 128 was measured with the whole
serial reduction on thread 0; with the terms staged across the block, bigger blocks pay.

## What was measured

- **Exactness on the GB10**: the exact lowering contract accepts all eight programs of the table, fused
  (`staging-gpu.test.mjs`), and stage 3's suites still pass on the staged emitter - `cuda-gpu.test.mjs` (11)
  and `fusion-gpu.test.mjs` (5), including both mutants of a fused row-sum kernel, the split-sum fused
  check, and rows beyond both shared-memory limits.
- **Staged paths exact against the interpreter** (`staging-gpu.test.mjs`): multi-axis reductions, two
  reductions in one member, max, a staged reduce reading a row buffer, empty extents (N=0 and C=0),
  attention-inside, a split sum staged at its outer block level, the serial-fold fallback (a 240 KiB term
  buffer), scratch rows with staged terms, and `runTixCuda`'s gated path - all bit-identical to `runTix`
  (NaN as a class).
- **Random programs** (script 05, stage 3's generator, seed 29): 20 programs before and after inline +
  split-sum - 40 lowerings, all accepted `exact`; the gated `runTixCuda` path bit-identical to the meaning
  in all 40; 7 programs carry staged reductions (including a split sum's outer level), 9 have block-mode
  kernels, 22 fuse statements.
- **Full-size outputs**: fused and unfused SHA-256 equal for all eight programs (script 04); stage 2 is
  exact at these sizes, so both equal the meaning. The interpreter at full size was not re-run (stage 3
  did; minutes per program).
- **Times and counts**: the table above; the calibration and crossover sweeps; the probes; the contract
  cost.

**Argued, not measured**: the exactness of the staging construction for programs outside the checked
samples; the row-member staging refusal and the scratch-term refusal (traffic counts); that the gate's
threshold generalizes beyond the four swept families to unmeasured structures; the microarchitectural
reason mlp crosses where attention does not (I measured the crossovers, not the cache behaviour that
separates them).

## What the contract checks and what it costs

`checkLowering` runs `tensor.lower-cuda` (version 2, unchanged) through the manager; the `ensures`
differential `tensor.cuda-meaning` compares every case's GPU output with the current revision's f32
meaning word for word, NaN as a class, on stage 2's case recipe (shape assignments from all-1/3/4/7, a
distinct-size mix, all-zero, one zero at a time; four input streams each; at most 4,096 elements per
tensor). The staged source is what the contract builds and checks; the small cases exercise the fill/fold
path (including empty extents) but not the memory fallbacks, which the GPU tests cover. Cost per program,
fused (script 07):

| Program | Cases | Elements in and out | Cold `checkLowering` | Repeat (memo) |
| --- | ---: | ---: | ---: | ---: |
| matmul | 36 | 816 | 2.7 s | 1 ms |
| softmax | 32 | 360 | 4.1 s | 1 ms |
| layernorm | 32 | 560 | 8.3 s | 2 ms |
| layernorm-inside | 32 | 560 | 10.3 s | 1 ms |
| attention | 40 | 1,300 | 7.2 s | 2 ms |
| attention-inside | 40 | 1,300 | 3.1 s | 1 ms |
| mlp | 40 | 1,520 | 17.1 s | 2 ms |
| conv2d | 28 | 17,000 | 19.5 s | 1 ms |

The cold wall is ssh, remote compile and process start (about as in stage 3; the machine is shared with
other agents, and these runs were taken under load). The staged source is no larger to compile.

## Framework and tool changes

**None**, and that is a result, not an omission. Everything this stage needed was already expressible:

- A **gated source checked through the contract** needed no new definition: `createCudaLowering` already
  accepted a candidate artifact, and supplying the gated source (with its kernels list) runs the same
  exact differential on it. `staging-gpu.test.mjs` uses this.
- The **`fuse` port, the statements-to-kernels correspondence and the differential memo** already keyed
  evidence by subject revision, so a gated source and the ungated one get separate evidence through the
  same definitions without any change.
- The one rule that bit stage 3 (an invariant must bind every port it declares) did not bite here.

The known framework gap stands, untouched as instructed: a correspondence's entity lists are declared by
the caller and not compared with the artifacts' entities; another ticket fixes it in
`src/framework/ir/`. `tools/cuda-remote.mjs` needed nothing (its `--timed` lock, build cache and
`--runtime-input` were used as they are).

The tensor-domain surface changes: `FusionGroup.parallelTerms` (with the path and description of each
staged reduction) and `gatedPlan(fn, shapeValues?)`; `blockThreads` and the cap computation
(`groupCap`) moved from the emitter into `fusion.ts`, with `cuda-source.ts` re-exporting `blockThreads`;
`model.value` accepts a `ReadonlyMap`; `runTixCuda` lowers through the gated plan. Everything the base
exports keeps its signature, `fuse: false` prints stage 2's bytes (digest test unchanged), and
`planFusion` keeps its legality rule and its result for the corpus.

## Later

- Staging row members' per-element reductions (per-element term buffers, or a different mapping; the flat
  term space of attention's `score` is 256 KiB per row).
- A structure-aware gate: a threshold per row-member structure, once more than one family crosses.
- An adaptive thread cap for few-row launches; several rows per block.
- The exactly rounded `exp` (softmax's floor), reassociating reductions, contraction tiling - all later
  stages, as before.
