# Implementation diary — IRWB-033-H

Chronological. Each step says what I did, what it gave, and what broke.

## Step 1 — reading the prior stages and the code

Read stage 3b's design and report, stage 3's design and report, then `src/tensor/` in full
(`fusion.ts`, `cuda-source.ts`, `cuda-contract.ts`, `cuda-runtime.ts`, `contract.ts`, `passes.ts`, `ir.ts`,
`model.ts`) and the framework pieces a second IR needs (`passes/define-pass.ts`, `contracts/definitions.ts`,
`strategy/{ir,registry,builders,interpreter}.ts`, `ir/adapters.ts`, `ir/correspondence.ts`).

What shaped the design:

- The fusion plan already decides everything the schedule needed to start from; the layout decisions that
  remained in the emitter were the thread cap (`blockThreads`), the shared/scratch choice, and the gate's constants
  — all of them expressible as fields.
- `applyNativePassSync` refuses a pass that declares `preserves`, and `applyPass` is asynchronous. `cudaSource` is
  synchronous by the fixed API, so a step's claim had to be checkable synchronously. That is framework change 1.
- The strategy interpreter is asynchronous (`run` returns a promise). A sync caller can still use the plan format,
  the registry and the validation, but not the interpreter. That is framework change 2.

## Step 2 — does the idea work at all (script 01)

A hand-written tiled GEMM with `__fmul_rn` / `__fadd_rn`, peeled tail, and a guard at the edges, compared word for
word against a one-thread-per-output kernel that does the meaning's own loop
(`scripts/01-exact-tiled-gemm-probe`). Shapes: 512³, 4096³, 37×130×91, 1×1×1, 3×4×1000, 128×128×0, five tile
configurations each.

Result: **bitwise-diff = 0 in all 30 combinations**, including `K = 0` and `1×1×1`. Time at 512³: 0.0720–0.1416 ms;
at 4096³: 16.9–31.2 ms. So the construction is sound before any compiler code exists, and the ceiling is not the
6× the brief mentions: the best forms were 3× faster than the current lowering (0.21 ms), not 6×, which matches
the arithmetic ceiling (FMUL+FADD is 14.39 TFLOP/s, so 512³ cannot go below 0.0186 ms).

## Step 3 — the tile sweep (script 02)

16 configurations × {512³, 4096³}, median of 20 timed launches each (`scripts/02-tile-sweep`). The points that
matter:

| Configuration | 512³ | 4096³ |
| --- | ---: | ---: |
| 32×32, 4×4 patch, k16 | **0.0637 ms** (4.21 TFLOP/s) | 20.83 ms (6.60) |
| 64×32, 8×4, k16 | 0.0822 | 20.24 |
| 64×64, 4×4, k16 | 0.0822 | 20.82 |
| 64×64, 8×4, k16 | 0.0719 | 16.34 |
| 64×64, 8×4, k32 | 0.0699 | **16.09 ms** (8.54) |
| 64×64, 8×8, k16 | 0.1088 | 24.65 |
| 64×64, 16×4, k16 | 0.0945 | 31.99 |
| 64×64, 8×4, k8 | 0.1336 | 32.40 |
| 128×128, 16×8, k16 | 0.1560 | 22.70 |

Two findings drove the rule: (a) 512³ prefers a *small* tile because 64×64 leaves only 64 blocks for 48 SMs, while
4096³ prefers a big one; (b) the arithmetic of a thread's inner step (2·RI·CJ instructions of multiply-add against
RI + CJ shared loads) explains why 8×8 and 16×4 lose: register pressure and, for 16×4, shared traffic. Both went
into the cost model as `fill` and `issue`.

`cudaSource` has no shape values, so the tile cannot be chosen at compile time without being wrong at one of the
two sizes. That is why the rule ends with a launch-time choice among printed variants (`schedule.launch-variants`),
which is a decision of the strategy, not autotuning: it is a formula over the shapes, and no candidate is timed.

## Step 4 — the schedule IR, the order analysis and the passes

`src/tensor/schedule.ts`: `ScheduleIR` (`tensor.schedule` v1) with the algorithm, one record per kernel, entities
(kernel, `kernel/statement`) and a `computes` relation. Bumped into a corner at once: the natural place for the
pass chain's revisions (`steps`) is the artifact, but a pass does not own that field, so `steps` is reported beside
the artifact by `scheduleOf` and travels in the CUDA unit's evidence instead.

The order analysis (`orderOf`) reads both halves: the meaning gives each statement's outermost reductions with
their axes in order, and the kernel's `contraction.order` says which way the two levels of the split reduction run.
Ascending/ascending normalises to the meaning's contiguous run; anything else does not. Every layout field that the
analysis does not know is listed as `unrecognized`, so a pass cannot add a layout unknown to the check and pass it.

Passes: `tile-reduction`, `bind-thread-patch`, `bind-block-tile`, `unroll`, `launch-variants`, plus
`double-buffer` (in the IR, refused by the rule, and the printer refuses to print it rather than silently ignore it).

Bug found by the first run of the rule: `bind-block-tile` after `bind-thread-patch` vs before. With the block tile
bound first (64×64) and the patch still 1×1, the thread count is 4096 and the pass refuses. The patch is what
divides the block tile, so the rule emits the patch first. Design doc updated in "as built".

## Step 5 — the emitter and the three bugs it took to make one kernel run

`emitCuda(schedule)` now dispatches on `mapping` and prints; `emitGroup` reads `threads.cap`, `gate` constants and
`rowMap` from the schedule instead of computing them. New `emitGemm`.

1. `template <int V>` bodies share one shared-memory area sized for the widest variant; each body uses its own tile
   as the stride. This keeps **one** `__global__` definition per kernel, which is the brief's kernel count.
2. Launch bug: I emitted `dim3(gridx, gridy, 0)` — a zero z dimension is an invalid launch. `checkLowering` said
   `invalid argument`; finding it took installing a print-and-exit macro in the generated `main.cu` and running it
   through `tools/cuda-remote.mjs` by hand.
3. The `fuse: false` path was tiled too, because the rule tiles *any* thread-mode single-statement contraction and
   stage 2's plan is exactly that. The stage-2 digest test caught it (matmul's unfused source no longer matched
   `02-stage2-source-digests.json`). `scheduleOf` now takes `{ tile }`, and `lowerToCuda` passes `tile: fuse`.

After that: `checkLowering(matmul)` = `{accepted: true, relation: 'exact'}`, and the probe script 03 shows
`cudaFuncGetAttributes` accepts the templated kernel (it was the `dim3` bug, not the template).

## Step 6 — the fallback, and the small shapes

The first table (script 04, three calls) showed the tiled lowering **slower** than stage 2 at three small shapes
(300×200×100: 0.031 against 0.013 ms; 128³: 0.021 against 0.011; 17×4096×33: 0.453 against 0.169). The tiled form
needs blocks to fill the machine; with 4 to 16 blocks it cannot. So the kernel also holds the statement's stage-2
form as one more instantiation and the launch runs it when the chosen variant's grid is below one block per SM.
`Contraction.fallback` records the decision and its measurements. With it, all three small shapes come out at
0.95–1.00 of stage 2 (the same kernel), and every larger shape stays tiled.

Also fixed here: my first `argmin` over the variant costs had its comparison inverted, so it picked the *worst*
variant (21.7 ms at 4096³ instead of 17.2).

## Step 7 — tests

`tests/tensor/schedule.test.mjs` (no GPU, 8 tests): the schedule of matmul and of every corpus program, the IR's
validation and entities, each pass's legality and refusals, the order analysis unchanged by every pass and by the
whole chain, two mutant passes rejected without a GPU (a reversed inner tile, and a third loop level the analysis
does not know), the plan's shape and the sync executor's refusals, and the printer's independence from shapes.

`tests/tensor/tiled-gpu.test.mjs` (GB10, 3 tests): tiled against stage 2 at 512³ and at six edge shapes (odd
sizes, `1×1×1`, `K = 0`, `M = 0`, and grids below one block per SM), against the interpreter where it is cheap, a
reversed reduction that must differ (so the comparison is not vacuous), the contract's exact acceptance, and a
swapped-operand contraction that must stay untiled and still run.

`tests/tensor/fusion.test.mjs` needed one change: it asserted that matmul's fused source equals its unfused source.
It now asserts that for conv2d (still true) and asserts that matmul is a tiled contraction.

## Step 8 — measurements

`scripts/04-bench.mjs` is the harness of this stage: medians of five interleaved `benchmark: true` calls per side,
per program and shape, with the two output digests beside each row. Results and the schedule IR's account are in
`reference/02-report-a-schedule-ir-and-exact-tiled-contractions.md`.
