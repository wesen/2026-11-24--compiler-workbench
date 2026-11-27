---
Title: 'Report: a schedule IR and exact tiled contractions through it'
Ticket: IRWB-033-G
Status: active
Topics:
    - tensor
    - gpu
    - compiler
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/schedule.ts
      Note: The schedule IR (v6 artifact, adapter), the build from the fusion plan, the contraction analysis and the order claim
    - Path: repo://src/tensor/schedule-passes.ts
      Note: The four scheduling passes, their legality, the gate and the accumulation-order analysis
    - Path: repo://src/tensor/schedule-strategy.ts
      Note: The rule that picks a schedule, its tile shape and the measurement behind it
    - Path: repo://src/tensor/cuda-source.ts
      Note: The emitter prints the schedule; the tiled contraction kernel and its launch-time body choice
    - Path: repo://src/framework/passes/define-pass.ts
      Note: A pass may read an artifact of another IR kind (PassSpec.source)
    - Path: repo://tests/tensor/schedule.test.mjs
      Note: The IR, the passes, the order check, the strategy and the refusals, without a GPU
    - Path: repo://tests/tensor/tiled-gpu.test.mjs
      Note: GB10 checks of the tiled body on every shape, the other contraction forms and the corpus contract
ExternalSources: []
Summary: A schedule IR between Tix and CUDA; the fusion plan builds it, four scheduling passes refine it, an accumulation-order analysis checks each step without the GPU, and a strategy picks the tiling. matmul 512³ 0.070 ms (2.1× cuBLAS, was 0.217), 4096³ 21.6 ms (6.4 TFLOP/s, was 134); attention's score 0.038 ms (0.061 of unfused, 2.1× cuBLAS); the two mlp GEMMs 0.101 and 0.132 ms. Nothing else got slower.
LastUpdated: 2026-11-27T11:40:00-05:00
WhatFor: Final report of stage 6 (IRWB-033-G)
WhenToUse: Reviewing the schedule IR, the tiling passes and their checks, what was measured and what was refused
---

# Report: a schedule IR and exact tiled contractions through it

Stage 6 puts a **schedule IR** between Tix and the CUDA source and makes a contraction fast through it. The fusion
plan of stages 3 and 3b builds the schedule; four scheduling passes refine it; every step is checked against an
analysis of the accumulation order before the GPU sees it; a strategy picks the tiling; the emitter prints.

| Contraction (sizes) | fused ms | unfused ms | fused/unfused | TFLOP/s | cuBLAS ms | fused/cuBLAS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| matmul 512³ | **0.070** | 0.210 | 0.33 | 3.84 | 0.0329 | **2.13** |
| matmul 4096³ | **21.6** | 134.0 | 0.16 | 6.37 | 7.16 | **3.01** |
| attention's score (1024², D 64) | **0.0375** | 0.618 | 0.061 | 3.58 | 0.0177 | **2.12** |
| attention's out (1024, 64, K 1024) | 0.0955 | 0.0968 | 0.99 | 1.41 | 0.0216 | 4.42 |
| mlp's h (N 1024, D 256, H 1024) | **0.101** | 0.466 | 0.22 | 5.32 | 0.0423 | **2.38** |
| mlp's y (1024, 1024, O 256) | **0.132** | 0.383 | 0.35 | 4.06 | 0.0475 | **2.78** |
| conv2d's out (8, 32, 62², C 16, 3×3) | 0.166 | 0.166 | 1.00 | 1.71 | – | – |

Every result is bit-identical to the f32 meaning on the contract's samples with both bodies forced, on the corpus at
full size against the unfused lowering, and on the other contraction forms. Nothing became slower: the four programs
that are not a tiled contraction emit the same bytes as stage 3b.

## Results

GPU time is `runTixCuda(..., { benchmark: true })`: one warm-up launch and the median of three CUDA-event intervals,
under the runner's `--timed` lock. Each row is the **median of five such calls**, alternating the two sides (A B A B
…); the five calls are in the `*.out.jsonl` files. Inputs are seed 20, f32 in [−0.1, 0.1]. Fused and unfused had the
same SHA-256 in every call of every program (`sameOutput: true` on every line of scripts 02 and 03).

| Program (corpus sizes) | Stages 3b (fused) | Now fused | Now unfused | fused/unfused |
| --- | ---: | ---: | ---: | ---: |
| matmul, M = K = N = 512 | 0.217 | **0.070** | 0.210 | 0.33 |
| softmax, N 4096, C 1024 | 0.385 | 0.387 | 0.787 | 0.49 |
| layernorm, N 4096, D 1024 | 0.170 | 0.159 | 0.480 | 0.33 |
| attention, Q=K=1024, D=V=64 | 0.746 | 0.745 | 1.053 | 0.71 |
| mlp, N 1024, D 256, H 1024, O 256 | 0.627 | 0.631 | 0.945 | 0.67 |
| conv2d, N 8, C 16, H=W 64, O 32 | 0.165 | 0.166 | 0.166 | 1.00 |

Softmax, layernorm, attention, mlp and conv2d are within 3% of stage 3b, in both directions; their sources are
unchanged (their kernels are the block-mode ones of stage 3b, and mlp and attention are still one kernel with the
gate). Only matmul changed, by 3.1×. The GEMMs inside attention and mlp are not tiled in those programs: they run
inside a block-mode kernel, one block per row (see *Refused*). The rows in the first table for attention and mlp are
the same contractions written as standalone programs, at the same sizes, which is what a tiled kernel does with
them: 0.0375 + 0.0955 = 0.133 ms against the 0.268 ms attention spends inside its fused kernel, and 0.101 + 0.132
against mlp's 0.631. Tiling them inside the fused kernel is the largest remaining win and needs several rows per
block (see *Later*).

**Reading the ratios.** cuBLAS's numbers are pedantic FP32 but with fused multiply-add, so they are a speed
reference and not a bit reference: at 3.84 TFLOP/s we are at 2.13× its 512³ time, and 4.35× its time for attention's
score in stage 2's mapping. The arithmetic ceiling of the meaning is FMUL + FADD at 14.39 TFLOP/s, so the 512³ tiled
kernel runs at 27% of it, the 4096³ one at 44%.

**The 4096³ row is the one to read with care.** Five calls per side at 4096³ move 3 × 64 MB per call through the
batch protocol, so the run takes minutes, not seconds; the SM clock was 2411 MHz before and after. Fused 21.43,
21.57, 21.64, 22.02, 21.43 ms (max/min 1.03); unfused 133.2, 133.4, 134.0, 135.7, 135.8 (1.02). No thermal drift
appeared. The tiled kernel's 6.37 TFLOP/s is 12% below the same tile shape hand-written (script 01: 7.27 TFLOP/s at
64×64×32×4×4), which is what the generic bounds tests and address arithmetic cost.

## The schedule IR

`src/tensor/schedule.ts`. An artifact of kind `tensor.schedule` (v1), validated, with an adapter that projects its
kernels as entities (`k0`, …) and its members as `fn/member`, contained in their kernel. One function's kernels:

```
ScheduleFunction { fn, source: {artifact, revision}, kernels, refusals, termRefusals }
ScheduleKernel   { name, mapping: thread|block, depth, members[], stored[], buffered[], staged[],
                   terms[], inPlace[], heavy[], gated, threads: {rule, cap}, contraction?, orders[], reasons[] }
ContractionSchedule { statement, reduction, block: [BI,BJ], lane: [TM,TN], kTile, stage: [a,b…], buffer }
ReductionOrder   { statement, reduction, nest: [{axis, kind: axis|strip|terms|block, extent, width?}] }
```

Everything except `contraction`, `orders` and `source` is stage 3b's plan, artefact-shaped: which statements share a
kernel, which values live in a row buffer or a register, whose terms all threads compute, which row buffer a member
is written over, which members the gate counts, and the thread-width rule (a rule over the shapes, with the measured
cap). `source` names the Tix artifact revision the schedule is of; `contraction` is the tiling; `orders` is what the
order analysis reads.

**Why the fusion decisions feed the IR rather than becoming passes.** The group rule of stage 3 is a whole-function
analysis: it reads every statement's reads, extents and reduction positions and decides which statements may share a
kernel. A pass over a schedule cannot make that decision — the statements are already placed — and a pass that moved
them would need the same whole-function analysis. So `planFusion` stays and `tensor.schedule-build` turns its verdict
into kernels (a cross-kind pass, below). 3b's staged terms and gate are constructs of one kernel, so they are
`terms`, `heavy` and `gated`. Cost: the bodies stay in the Tix artifact, which the schedule names by revision, so a
scheduling pass that must look at a reduction's body takes the function as a parameter. Benefit: every decision after
the build is a checked pass on one kernel.

**The pipeline is Tix → schedule → CUDA** (`emitSchedule(fn, schedule)`); `emitCuda(fn, plan)` is kept as
`emitSchedule(fn, scheduleFromPlan(fn, plan))` for the tests and for `fuse: false`, which schedules nothing.

## The scheduling passes

`src/tensor/schedule-passes.ts`. Each is a `definePass` over `tensor.schedule` with declared `writes`, its legality
decided from the IR (a refusal throws `ScheduleRefusal` before any revision exists), applied through
`applyNativePassSync`, which diffs the two projections, builds the entity correspondence and enforces the declared
writes. The strategy's steps, in order:

| Pass | Writes | Legality from the IR | Correspondence |
| --- | --- | --- | --- |
| `tensor.schedule-build` v1 | everything | the plan's rules; every statement in exactly one kernel | Tix statements → kernels and members (derived) |
| `tensor.schedule-tile-domain` v1 | `contraction.block/lane` | rank-2 single-member thread-mode kernel, one outermost `sum` over one `dim` axis, body = two reads that walk the rows and the columns against the reduction; `TM|BI`, `TN|BJ`, 32…1024 lanes, a warp multiple | kernel and member entities retained (`blocks`/`members`) |
| `tensor.schedule-tile-reduction` v1 | `contraction.kTile` | tiling exists; the reduction is not already split (a `blocks` or `tail` extent) | kernels retained |
| `tensor.schedule-stage-operand` v1 | `contraction.stage/buffer` | tiling exists; staged tiles fit 90 KiB of shared memory; two buffers need a prefetch this stage does not implement | kernels retained |

`contractionOf` is the legality kernel: it accepts `a[i,k]*b[k,j]`, `a[i,k]*b[j,k]`, `a[k,i]*b[k,j]` (both operands
in either position, constants allowed, so `a[i,k+1]` qualifies too), an epilogue around the reduction, and refuses
everything else with a reason (`it runs in block mode`, `its reduction is over 2 axes, not 1`, `the reduction's body
does not multiply two tensor reads`, `its reduction is a max`, …). The refusals are recorded in the strategy's steps
and in a test.

## What a step is checked by, without the GPU

`tensor.accumulation-order` (v1) is an analysis over the schedule: for every kernel, member and outermost reduction it
returns the **visit order of that reduction's indices as the emitted code will run it**, flattened to the meaning's
sequence. An untiled reduction is `k 0..K step 1`; the tiled one is a `strip` level outside and the axis inside, and
the flattening of a strip-mine (outer climbing, inner climbing from it, bounds `min(k0+KC, K)`) is the same sequence,
and so is a fold over a term buffer in order. Two schedules with the same claim visit every output's terms alike.

`flattenOrder` keeps a level of any other kind (`block`) as a level of its own, so a nest that does not walk the axis
once in increasing order compares unequal — a split-K (a parallel axis outside the reduction's) or a reversed inner
loop is *structurally* rejected. Every scheduling pass is applied through `scheduleGate`, which recomputes
`orderClaim` on the output and compares it with the input's, so a pass that reordered a reduction never produces a
revision. Two tests build such passes by hand (a reversed nest, a `block` level) and both are refused, one through
the synchronous gate and one through the framework's asynchronous `preserves` (`applyPass` with
`preserves: [AccumulationOrder]` gives `confirmed-by-recompute`; the mutant gives `preserveViolated`).

The gate also checks that every statement is a member of exactly one kernel — the coverage the build must keep.

**What the order check covers, and what the GPU check still covers.** Covered: the order in which each output
element of each outermost reduction visits its terms, for every kernel of the schedule. Not covered: that the printed
code visits the terms in the order the IR declares (the emitter is trusted, not verified), the tile copies and their
index arithmetic, one accumulator per output across tiles, the guards, and the arithmetic itself. The GPU check covers
those: `checkLowering` runs the differential against the current revision's f32 meaning under the exact relation with
both bodies forced, and `tiled-gpu.test.mjs` compares the tiled body with the interpreter on ten shapes (including
1, 0 and non-multiples of every tile size). The order check is cheap: the whole strategy takes 4 to 20 ms per
program, and it is what makes a reordering pass impossible to write by accident.

## The tiled contraction

Printed from `ContractionSchedule` (`emitTiledContraction`), one block per 64×64 output tile, one lane per 4×4 patch:

```
for k0 = 0, 32, … :
   copy a's strip [64][32] and b's strip [32][64] into shared memory (bounds-guarded, 0 outside)
   barrier; for kk = k0 … min(k0+32, K): acc[m][n] = __fadd_rn(acc[m][n], __fmul_rn(va[m], vb[n])); barrier
store the patch, bounds-guarded                        // one accumulator per output across all strips
```

The strip loop climbs and the inner loop climbs from it; the tail is bounded by `min`; there is one register
accumulator per output element for the whole reduction, and the product and the sum round separately (never fused).
The tile copies read the operands through the same affine address code as the rest of the emitter, so a transposed or
shifted operand needs nothing new; each copy walks the operand's *own* innermost index fastest, so global reads stay
in order whatever the layout, while the shared tile's layout is fixed (`[BI][KC]`, `[KC][BJ]`). An epilogue
(`(sum(k) …) + bias[j]`) is the existing expression walk with the tiled reduction returning `acc[m][n]`.

**One kernel definition, two bodies** (`template <bool Tiled>`): the second is stage 2's per-element mapping, and the
host picks between them from the shapes. The kernel count is unchanged (1 for matmul). A source with a tiled kernel
takes `--tile=tiled|plain`, exactly as a gated source takes `--gate=fused|unfused`, so the contract checks both
bodies on every sample.

**The launch rule, and why it is measured.** Below a threshold the tile copies cost more than the reuse saves: the
tiled body was 2.0× slower at 64³, 1.7× at 128³, 1.5× at 160³, 1.1× at 192³, 1.14× at 224³, and 0.86× at 256³
(script 01, medians of three, one session). So the host uses the tiled body when `M·N·K ≥ 1.5·10⁷` — between the last
measured loss (224³ = 1.12·10⁷) and the first measured win (256³ = 1.68·10⁷) — **and** the grid has at least as many
blocks as the device has SMs (48 on the GB10, queried at launch). The second condition came from the measurements of
this stage: attention's out (1024×64, grid 16 = a third of the SMs) was 1.04 of the per-element body when tiled and
0.99 when not, while matmul at 512³ (grid 64) was 0.16. With both conditions the rule picks the tiled body for every
large contraction in this report and the per-element body for small and narrow ones.

**Tile shape: 64×64 per block, 4×4 per lane, 32 terms per strip, both operands staged.** Script 01 (hand-written
kernels outside the compiler, medians of three): at 512³, 64×64×32×4×4 gave 0.0637 ms, 64×64×64 0.0617, 32×32×16
0.0717, 128×128×32×8×8 0.125; at 4096³, 128×128×32×8×8 gave 15.8 ms and 64×64×32×4×4 18.9. One static shape cannot
be best at both, and the extents are symbolic at compile time, so the strategy takes the shape that is best at scale
512 and good at 4096 — the size of the headline case — and leaves the launch-time choice of shape to a later stage.

## The strategy

`src/tensor/schedule-strategy.ts`, a function of the IR, no timing:

1. `schedule-build` with the caller's `fuse`;
2. for every kernel `contractionOf` accepts, in kernel order: `tile-domain 64×64/4×4`, `tile-reduction 32`,
   `stage-operand a,b` (single buffer).

It returns the schedule, the artifact and the list of steps taken (pass, version, parameters, applied, changed,
edits, refusal). `fuse: false` applies no step, so stage 2's bytes are unchanged.

**Why not `src/framework/strategy`.** Its interpreter is asynchronous (`S.execute` returns a promise for a trace) and
its algorithms exchange plain JSON through an `(id, version)` registry; the lowering must stay synchronous (`cudaSource`
is a synchronous export) and its steps exchange frozen content-addressed artifacts whose revisions are the evidence.
The strategy keeps the same shape — an ordered plan of named versioned steps with parameters, each with its own
legality and check, each returning the framework's `PassResult` — without the interpreter. Making the strategy
interpreter synchronous would be the change that lets `S` carry this; it does not exist yet and is listed as later
work. `toggle`-style edits (`S.replace`) are not needed: the steps are a fixed sequence per kernel.

## New approaches tried

- **An accumulation-order analysis that makes reordering passes impossible** (the design's "prove order preservation
  from the IR, so a step needs no GPU check"). Works: it is 4 to 20 ms per program, it rejects a reversed nest and a
  split-K by shape, and it is what turns "the tiling keeps the bits" from an argument in a report into a check that
  runs on every compilation. What it cannot see is the emitter; that gap is named above.
- **A cross-kind v6 pass** (Tix → schedule) through the framework's own pass machinery, with a diff, a
  correspondence and a gate, instead of a bespoke lowering function. Works after the one framework change below; the
  pass result carries the change set and correspondence like any other pass, so the schedule's provenance is the
  framework's, not the domain's.
- **One kernel definition with two bodies chosen at launch** (the gate's trick, reused for the tiling). Works: the
  kernel count stays 1 and the contract forces each body. It cost a second response byte per case (`tiles` in
  `CudaResult`) and a second flag in the differential's case recipe.
- **Copying each tile along the operand's own innermost index.** This is what made the transposed operand
  (`sum(k) q[i,d]*k[j,d]`, attention's score) fast: 0.0375 ms against 0.618 untiled, 2.1× cuBLAS. Without it the copy
  reads with a 64-float stride and the whole contraction pays for it.
- **A launch-time grid condition** in addition to the work threshold: measured, then added, because 16 blocks of a
  48-SM device lost to the per-element body while 64 blocks won 3×.
- **Not** tried, for want of a reason to believe them: vector loads (measured and refused, below), double buffering,
  and an IR-level cost model (the report's timings are the model, and it has three constants).

## Refused schedule choices, with the reason

- **Vector (`float4`) loads and stores**: measured first (script 01, 512³): 0.0756 ms with a vectorised second
  operand's copy and a vectorised store against 0.0637 without, at the same tile. A schedule step that the strategy
  does not choose is not worth its check, so the IR has no vector field and the pass does not exist.
- **Double buffering**: it needs a prefetch that overlaps the copy with the arithmetic (a rotated buffer the compiler
  can software-pipeline, or an async copy). With two barriers per strip the copy cannot overlap, which is why the strip
  is 32 terms and not 8. The IR keeps `buffer: single|double` and the staging pass refuses `double` with that reason.
- **Splitting the reduction (split-K) or any tree**: forbidden by the brief and rejected structurally by the order
  analysis.
- **Tiling the block-mode groups** (attention, mlp): one block per row means the operand reuse inside a block is
  bounded by the row, and a fast version needs several rows per block — new row-buffer layouts and a block-domain
  tile. Theirs remain stage 3b's kernels, byte for byte.
- **Tiling a contraction that is not the only member of its kernel**, or one in block mode: refused by
  `contractionOf` with a reason, because the tiled body's mapping (one block per output tile) is not the block-mode
  mapping (one block per block-domain point) and mixing them needs the row tiling above.
- **Tile sizes chosen by timing** (autotuning) and **a second tile shape chosen at launch**: both left to later.
- **A `vectorize`/`unroll`/`reorder` pass for its own sake**: the unrolling that matters is inside the strip
  (`#pragma unroll` on the 4×4 patch), and a reorder pass would have nothing legal to do — the only reordering that
  would speed up a contraction is barred by the order analysis.

## Framework and tool changes

**`src/framework/passes/define-pass.ts`**: a pass may now read an artifact of another IR kind, through a new optional
`PassSpec.source: {ir, adapter}`, and `applyNativePassSync` takes an optional output artifact id.
- *Reason*: the Tix → schedule step is a pass whose input is a `tensor.tix` artifact and whose output is a
  `tensor.schedule` artifact. The framework opened the input with the pass's own adapter, which validates the
  artifact's kind and schema, so a cross-kind pass could not be written at all: the input failed validation before the
  pass ran. A framework finding, and the brief's "passes between IR kinds".
- *Also fixed in passing*: `applyNativePassSync` had no way to name the output artifact, so a cross-kind output would
  have inherited the input's id.
- *Tested*: `tests/tensor/schedule.test.mjs` builds the schedule through the pass and checks the artifact, the
  correspondence and the gate; the framework's own tests are unchanged and pass.

Nothing else under `src/framework/` or `tools/cuda-remote.mjs` changed. What the framework already had, and fitted:
`defineIR` with `entities` and a validator (the schedule is checked like any artifact), `defineAdapter` (the schedule's
projection, so the pass machinery can diff and correspond), `defineAnalysis` (the order analysis, with the framework's
`preserves` recompute-and-compare as an alternative path to the synchronous gate), and the differential memo, which
needed only its two new flags in `baselineKey`.

**Tensor domain.** `schedule.ts` (IR, adapter, build, contraction analysis, order claim), `schedule-passes.ts` (four
passes, the gate, the analysis, `applyScheduleStep`), `schedule-strategy.ts` (the rule). `cuda-source.ts`: the
emitter now prints a `ScheduleFunction` (`emitSchedule`), gains the tiled contraction and the `--tile` flag, and the
thread-width rule moved from the emitter into the schedule. `cuda-runtime.ts`: `tile` option and `tiles` in the
result. `cuda-contract.ts`: `CudaIR` v3 (`tiled`), `tensor.lower-cuda` v3 (builds the schedule through the strategy),
gate × tiling sides in the case recipe and in `baselineKey`. `index.ts`: exports `tixSchedule`.

## What the contract checks and what it costs

`checkLowering(program, fn, {fuse})` runs `tensor.lower-cuda` v3, which now builds the schedule with the strategy and
prints it. The `ensures` invariant is unchanged: every case's GPU output against the current revision's f32 meaning,
word for word, NaN as a class. The case recipe gains one dimension: for a source with a tiled kernel, every sample is
also a case with `--tile=tiled` and one with `--tile=plain` (and for a source with both a gate and a tiling, all four
variants). The samples are small, so the launch rule alone would never reach the tiled body; forcing it is what makes
the check cover both.

Cost, measured on the GB10 with the binary already compiled remotely (script 04, `scripts/04-contract-cost.out.jsonl`;
wall time of one `checkLowering`, then of a repeat that replays the memo):

| Program | Sides | Fused: wall (repeat) | Unfused: wall (repeat) |
| --- | --- | ---: | ---: |
| matmul | 2 tiling bodies | 4.6 s (82 ms) | 3.6 s (55 ms) |
| softmax | 2 gate sides | 4.4 s (113 ms) | 3.1 s (32 ms) |
| layernorm | 2 gate sides | 4.0 s (55 ms) | 3.6 s (41 ms) |
| attention | 2 gate sides | 4.0 s (85 ms) | 3.5 s (73 ms) |
| mlp | 2 gate sides | 3.6 s (95 ms) | 3.2 s (32 ms) |
| conv2d | one | 4.1 s (1.6 s) | 1.1 s (1.3 s) |

The tiling doubles matmul's case count (36 → 72) and its wall time from the 2.7 s stage 3b measured to 4.6 s, because
the same samples now run twice, in parallel, from one compilation. Everything else is at stage 3b's cost. The order
analysis and the four passes add 4 to 20 ms per program, which is invisible next to that, and the wall time is mostly
ssh, upload and process start.

## Tests

`tests/tensor/schedule.test.mjs` (15 tests, no GPU): the artifact and its entities, the build naming its Tix revision,
the strategy's four steps and its refusal list, the tile-size legality, the order claim through the strip-mine and its
two mutants, the gate rejecting a reversed reduction (synchronously and through the framework's `preserves`), the
staging refusals, the shape of the printed kernel (one accumulator, strip outside, `k` inside, no FMA), every corpus
program's schedule, `fuse: false` still byte for byte stage 2, and a split sum not being tiled.

`tests/tensor/tiled-gpu.test.mjs` (7 tests, its own file so the rest run without a GPU): the tiled body exact against
the interpreter on ten shapes, 512³ fused against unfused, the other contraction forms, a refused form staying exact,
`checkLowering` for the corpus with every launch-time side, and the corpus at small sizes.

One existing assertion changed, in `tests/tensor/fusion.test.mjs`: a one-statement program used to be byte-identical
fused and unfused, and matmul deliberately no longer is. conv2d (a one-statement program that is not a contraction)
still is, and both `fuse: false` digests per program are unchanged. The rest of the suite — including stage 2's,
stage 3's and stage 3b's GPU tests, the gate's, the staged terms' and the mutation checks — passes unchanged
(`various/existing-gpu-suites.log`).

## Measured, and only argued

**Measured on the GB10:**
- every row of both results tables (five `benchmark` calls per side, alternating, `*.out.jsonl`);
- `checkLowering` accepting the corpus, fused and unfused, for matmul, attention and mlp (both sides of every
  launch-time choice) and fused for softmax, layernorm and conv2d — `tiled-gpu.test.mjs`;
- the tiled body exact against the interpreter on ten shapes: 1×1×1, 3×1×4, 17×3×5, 40×96×33, 64×64×64, 96×40×70,
  129×65×63, 2×129×2, 0×4×3 and 5×0×7, each with both bodies forced; and matmul 512³ fused against unfused word for
  word;
- the other contraction forms exact: transposed operand, `a[k,i]*b[k,j]`, an epilogue with a bias row, and a refusal
  case;
- the corpus at small sizes, fused and unfused against the interpreter;
- the launch rule's two thresholds and the tile shapes (script 01, and the 512³/4096³ and attention/mlp rows of
  script 03 before and after the grid condition was added);
- the SM count the launch rule reads (48).

**Argued, not measured:**
- that the tiled kernel keeps the bits for *every* shape and every accepted contraction form. The argument: the strip
  loop and the inner loop visit k = 0 … K−1 once, in order, into one register per output, with separately rounded
  product and sum, and the plane tiling only decides *which thread* computes an output, never the order in which that
  output accumulates; the tiles are word copies; an epilogue runs after the reduction, as the meaning has it. The
  samples above are what tests it.
- the same for the order analysis: it compares the *declared* nest, and the emitter is trusted to print it (checked by
  the GPU samples, not proved).
- that no program became slower: measured for the corpus, at the corpus sizes, for six programs; "never slower" for
  other programs and shapes rests on the launch rule, which keeps the per-element body below 1.5·10⁷ and below one
  block per SM.

## Later

- **Tiling inside the block-mode fused kernels** (attention, mlp): several rows per block with row buffers of `[BI][row]`,
  a block-domain tile, and the contraction staged inside. Measured potential: the standalone GEMMs of those programs run
  in 0.133 and 0.233 ms against 0.268 and 0.53 of their fused kernels' GEMM time.
- **A shape-dependent tile, chosen at launch** between instantiations (`template <int BI, int BJ, int KC, int TM, int
  TN>`), by the extents: 128×128×8×8 for 4096³ (8.7 TFLOP/s hand-written against 7.3), 64×64×4×4 for 512³.
- **Double buffering** with a software-pipelined copy, and vector loads once a pass can be checked for them.
- **A cost model in the IR** for the tile decision instead of three constants.
- **A synchronous executor for `src/framework/strategy`**, so the schedule's steps can be a strategy plan with its
  trace, budgets and `fork`/`chooseBest` over shapes.
- **`tensor.schedule` as a v6 artifact that the CUDA correspondence names**: now the correspondence goes from Tix
  statements to CUDA kernels; with the schedule's kernels as entities it could go statement → schedule member → CUDA
  kernel in two checked records.
- The stage-1 `split-sum` program is not tiled (`contractionOf` refuses a reduction whose extent is already a `blocks`
  or `tail` pair); a tiled split sum would keep both levels' order and is only a pass away.
