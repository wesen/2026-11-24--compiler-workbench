---
Title: A schedule IR, and exact tiled contractions through it
Ticket: IRWB-033-J
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/schedule.ts
      Note: The schedule IR, its adapter, the order certificate, and the scheduling passes
    - Path: repo://src/tensor/cuda-source.ts
      Note: The emitter prints the schedule; new tiled contraction kernels and staged member tiles
    - Path: repo://src/tensor/cuda-contract.ts
      Note: The lowering plans the schedule, emits from it, and records both artifacts
    - Path: repo://src/framework/passes/bridge.ts
      Note: passAlgorithm gains a synchronous gate mode for schedule passes
ExternalSources:
    - 'Yang, Riasanovsky, Deng and Sarkar: Taming Bitwise Behavior in GPU Kernels with Tensor Core, arXiv 2609.11356 (2026)'
Summary: A schedule IR as a v6 artifact between Tix and CUDA; fusion and tiling become passes on it, each gated by an order certificate proven from the IR; contractions lower to exact tiled kernels; the strategy layer runs the pipeline.
LastUpdated: 2026-11-27T10:30:00-05:00
WhatFor: Design of stage 6 before implementation
WhenToUse: Reviewing the schedule IR, its passes, the tiled kernels and what each check covers
---

# A schedule IR, and exact tiled contractions through it

## Goal and domain

Make contractions fast without changing any result bit, and make the *structure* of the lowering a checked
pipeline: a **schedule IR** as a v6 artifact between Tix and CUDA, rewritten by v6 passes, printed by an emitter
that decides nothing. The domain is stage 3b's: any function of the checked core, any shapes the GB10 can launch,
including shapes that are not multiples of a tile, empty extents, and contractions over a short or a single index.
`fuse: false` keeps printing stage 2's bytes (the digest test stays). No program may get slower than it is now.

Not in this stage: split-K, tree reductions, FMA contraction, tensor cores, reduced precision, and autotuning by
measured search. The schedule IR leaves room for them (the reduction axis is an explicit schedule dimension).

## The pipeline

```
Tix IR ──(tensor.plan-schedule, a checked transformation)──▶ schedule IR r0 (one plain kernel per statement)
       ──(tensor.schedule.fuse)──▶ r1  groups, mappings, terms, in-place rows, gate
       ──(tensor.schedule.tile)──▶ r2  tiled contractions, staged operand tiles
       ──(tensor.schedule.pipeline)──▶ r3  double buffering where it fits
       ──(emitCuda: prints the schedule)──▶ CUDA source
```

The schedule IR's value is `{ fn, program, kernels, refusals, tileRefusals }`: the **algorithm** (a frozen copy of
the Tix function — the same JSON the Tix artifact holds) and the **schedule** (one record per kernel). In Halide's
and TVM's spirit the algorithm says *what* is computed, the schedule *how*. Stage 3 refused a kernel IR because
"nothing would edit it between planning and emission"; stage 6 is the later stage that report named: passes edit
it, a property checks it, and the emitter consumes it.

A kernel record carries, per kernel: its members, its mapping (`thread`, `block`, or `gemm`), the block depth,
the rows it stages and buffers, which reductions get staged terms, in-place rows, heavy members, the launch-time
gate and its constants, the thread-count rule and its caps, and — added by the tile pass — either a `gemm` tile
(standalone contractions) or per-member **operand tiles**. Everything the current emitter derives from the
`FusionGroup` plan is a schedule field, so the emitter only prints.

## The passes

Each is a `definePass` on the schedule IR (same kind in and out), applied with `applyNativePassSync`, which diffs
the two revisions through the adapter, enforces the declared `writes`, builds the correspondence to the revision
before, and runs our gate. Each pass records refusals with reasons in the schedule value.

- **`tensor.schedule.fuse`** applies stage 3/3b's fusion legality — `planFusion`, decided from the embedded
  program before anything is written — and turns its groups into schedule constructs: mapping, staged rows,
  buffered rows, staged terms, in-place rows, heavy members, the gate. The correspondence merges the singleton
  kernels of r0 into the fused kernels. *Why a pass and not a plan that feeds the emitter:* the brief offers both;
  a pass puts the decision in the checked pipeline, keeps one implementation of the legality, and lets later
  stages (block-domain tiling) re-decide it as a schedule rewrite. *Why one pass for groups, terms and in-place:*
  they are one legality analysis of the same block-mode construction; splitting them would order passes that share
  all their inputs and none of their value.
- **`tensor.schedule.tile`** decides tiling from the IR, per kernel (legality below), with tile sizes as pass
  parameters supplied by the strategy (data, not code). It sets `mapping: 'gemm'` on a standalone contraction and
  `memberTiles` entries inside block-mode kernels.
- **`tensor.schedule.pipeline`** sets double buffering on `gemm` kernels whose two tile buffers fit shared memory
  (a constant check: both tiles are compile-time sized). Block-mode tiles keep one buffer: their rows are
  launch-sized, so double buffering would need another host rule and template; listed under Later.

## Legality of tiling, decided from the IR

`contractionOf(statement)` recognizes the exact form both tiled paths compute (one implementation, shared by the
pass and the checker):

- the statement's expression is `E(sum(r) L * R)` — one outermost reduction, a single axis with a plain extent
  (anything from `split-sum` is refused), body exactly a product of two loads, `E` an epilogue tree that never
  reads `r` and contains no nested reduction;
- `L` and `R` together carry each output axis exactly once, at identity, with no other indices and zero offsets
  (conv2d's `y+dy` and its three reduction axes are refused, with the reason recorded).

- **A standalone contraction** (a singleton thread-mode kernel, like `matmul`) becomes `mapping: 'gemm'`: the
  output axes carried by `L` tile by BM, those carried by `R` by BN, the reduction axis by chunks of BK; each of
  `(BM/TM)·(BN/TN)` threads owns a TM×TN register patch; both operands are staged in padded shared tiles (each
  word is reused across the tile, whatever the access pattern). Refused when either side carries more than one
  output axis (rank > 2).
- **A contraction member of a block-mode kernel** (attention's `score`, `out`; mlp's `h`, `y`) gets an **operand
  tile** only when all of these hold: `L` is one of the kernel's row buffers, read at `[block indices, r]`
  (its row is exactly the reduction extent); `R` reads `r` and the member's trailing axes at identity; and the
  member's lanes would read `R` **uncoalesced** — that is, when the trailing axes do not occupy `R`'s last index
  positions (lanes differ in the trailing coordinate; if that coordinate is `R`'s minor dimension the warp's
  reads are already consecutive). The tile covers `threads × BK` words: the trailing coordinate across the
  block's lanes and one reduction chunk, loaded cooperatively (coalesced), padded so the serial reads are
  conflict-free. **Refused when `R` is already coalesced** — the tile is then a shared-memory round trip with no
  reuse (each word is used by one output element of one block row): this refuses mlp's `h` and `y` and
  attention's `out`. mlp's contraction floor is L2 volume per block row; only block-domain tiling (several block
  points per block) fixes it, which breaks the one-row-per-block protocol of stages 3/3b: Later.

## What each output's accumulation order is, and who checks it

Every output element must accumulate its terms one at a time, in the meaning's order, rounding the product and
the sum separately. The schedule IR is rich enough to say, for every reduction of every member, *how* the
schedule computes it, so a checker can classify each one:

- `serial`: one thread, a loop nest in lexicographic order (stage 2's mapping, thread 0 of a block, a member's
  per-element loop);
- `staged-terms`: terms computed anywhere, folded by one thread in row-major order (stage 3b);
- `tiled-serial`: **proven from the schedule value**: the tile spec binds threads, patches and tiles to output
  axes only; the reduction axis is never split across threads or blocks; the chunk loop and the in-chunk loop
  both increase, so the visited order is exactly 0, 1, 2, …; each output element has one accumulator register
  from chunk 0 to the end. The checker re-runs `contractionOf` and re-verifies the constants (divisibility,
  warp-multiple thread count, positive chunk), so a hand-edited schedule that tiles something else, or with
  inconsistent sizes, is rejected.

`tensor.schedule.order` is a `defineProperty` + `defineAnalysis` on the schedule IR; its value is the
**order certificate**: one classification per reduction. Every scheduling pass is gated by it
(`applyNativePassSync`'s gate): the gate runs the checker on the candidate and rejects a schedule whose
reductions are not all classified, or whose `tiled-serial` classifications fail the structural proof. The plan
transformation's trivial schedule is checked the same way.

**What this covers and what it does not.** The certificate proves, from the IR, that no step reorders, splits or
reassociates any reduction, and that tiled paths keep each output's fold in one thread. What it *assumes* is the
fidelity of the paths it classifies as `serial` and `staged-terms`: those are stage 2's and 3b's argued
constructions, unchanged by this stage. What the GPU check (`checkLowering`, exact relation) still has to cover:
everything about the printed code — addressing, masks, barriers, staging copies, the epilogue, the host's launch
rules — and the scalar arithmetic. So: order is proven per step; code generation is checked once, at the end,
bit for bit.

## The kernels

**`gemm` (standalone contraction, e.g. matmul).** Grid: one block per output tile; threads: a
(BM/TM)×(BN/TN) patch grid; shared: two padded tiles (A: BM×BK, B: BK×BN), doubled when `pipeline` set
double buffering (one barrier per chunk instead of two). Per chunk: all threads cooperatively load the tiles
(coalesced, masked at the edges), then each thread runs its patch's inner loop: `acc[u][w] = __fadd_rn(acc[u][w],
__fmul_rn(a_tile[u][t], b_tile[t][w]))` — the same instruction sequence per output element as the meaning, in
increasing `k`. Chunks split into a constant-trip loop plus a remainder loop, so nvcc can unroll the common
case; the remainder keeps the order for any K. Masks fill out-of-range loads with 0 and guard stores; an element
beyond the extent is never stored, and an in-range element's terms are exactly `k = 0…K−1`. Empty M, N or K all
degenerate correctly (empty sum = +0, then the epilogue).

**Block-mode operand tiles (attention's `score`).** The member keeps today's element assignment (thread `t`
computes elements `t, t+blockDim, …`), its row buffer, its barriers and its epilogue; only the reduction's reads
change: per trailing tile and chunk, all threads load `R`'s tile cooperatively and each thread folds its
element's chunk from shared memory, serially, in order. Two barriers per chunk (the pipeline pass does not apply
here). The tile lives after the row area in shared memory (or at its base when the rows went to scratch), always
in shared memory; the host's shared budget gains the tile bytes, a launch-time quantity like the rows.

Sizes start at BM = BN = 64, BK = 32, TM = TN = 4 (256 threads) for `gemm`, and BK = 16 for operand tiles, and
are fixed from measurement (scripts in this ticket), never per-shape at run time: masked tiles handle every
shape. Per-shape tile choice needs launch-time kernel selection and is left for the stages that also pick
split-K.

## The strategy

`src/framework/strategy` runs the pipeline where it fits: a `StrategyPlan` — `plan` → `conditional(fuse?)` →
`fuse` → `tile` → `pipeline` — whose `apply` nodes carry the tile sizes as `args` (the plan is data), executed by
`S.execute` with the passes registered as algorithms. Where it does not fit, said plainly:

- `cudaSource` is synchronous by the fixed API and `S.execute` is an asynchronous interpreter, so the plain
  lowering path calls the same versioned step functions in the plan's order directly. A test asserts the two
  paths produce the same schedule.
- The strategy layer sees artifacts as opaque JSON values. The decisions that need the IR (which kernel tiles,
  which operand stages) live inside the versioned passes; the strategy can sequence them and carry their
  parameters, nothing more.
- `chooseBest` would host a measured search; autotuning is excluded from this stage, so the plan is a fixed
  sequence. The tile sizes in its `args` are the natural place for a later shape-aware selector.

The framework bridge `passAlgorithm` gains a `gate` mode (see Framework), so the passes run under the strategy
with the same synchronous order gate as outside it.

## Contract

`tensor.lower-cuda` v3 takes the schedule as an input port and the CUDA artifact embeds it; `CudaIR` goes to
version 3 (`kernels` gain the `gemm` mapping). `checkLowering` then runs: the plan transformation through the
manager (its `scheduled-as` correspondence — every Tix statement to its schedule member — is checked against both
artifacts' entity lists), the passes as a strategy plan, and the lowering transformation, whose `ensures` is
unchanged: the exact differential against the current revision's f32 meaning, every case on both sides of any
gate. The step records (`pass, changed, reason` like `optimizeTix`'s) come out of the strategy trace and the pass
results.

## Refused, and why

- **Block-domain tiling for block-mode groups** (several block points per block): the only fix for mlp's
  contraction volume; it reworks the row, term, in-place and gate protocol of stages 3/3b. Later.
- **Staging an already-coaleszed operand** (mlp's `w`, `v`; attention's `v`): a shared round trip with no reuse.
- **Register patches (TM > 1) in block mode**: they do not reduce the operand traffic (no reuse within a block
  row) and change the element assignment; measured later if the tile wins.
- **Vectorized (float4) tile loads** in the emitter: the emitter prints scalar reads from the schedule and lets
  nvcc vectorize the constant-trip loops; nothing in the schedule needs to say `float4`.
- **Tiling max-reductions, multi-axis or `blocks`/`tail` reductions, affine operand reads** (conv2d), **epilogues
  that read the reduction axis**: outside the proven form; the generic serial path computes them, as today.
- **Transposing operand tiles in shared memory**: padding gives conflict-free serial reads without a transpose.

## Framework and tool changes

- `framework/passes/bridge.ts`: `passAlgorithm` gains an optional synchronous `gate` (it could only apply passes
  through the analysis manager with a transformation contract; schedule passes are gated by the order property's
  checker, synchronously).
- Anything the second IR, the cross-kind passes or the entity-checked correspondences turn out to need beyond
  this is a finding of the stage and goes in the report with its reason. Candidates probed during design: the
  pass machinery is same-IR by design (fits: the schedule passes rewrite one IR); the plan step is cross-IR and
  uses the existing transformation path; the correspondence checker already compares entity lists against both
  artifacts (F23/F24), which the `scheduled-as` record exercises.

## Measurements

Scripts in this ticket, all through `runTixCuda(..., { benchmark: true })` under the `--timed` lock, medians of 12
interleaved calls per program and side, alternating the two variants, differences under 5% treated as noise:

1. matmul 512³ and 4096³: tiled against the current lowering, TFLOP/s, ratio to cuBLAS (given: 0.0329 ms and
   19.2 TFLOP/s; the SM clock is checked at 4096³). Tile-constant sweep (block, chunk, patch, double buffer) to
   fix the rule's constants.
2. attention, mlp, conv2d and every corpus program, fused and unfused, against the base numbers, so no program
   got slower.
3. The contract's case count and wall time on the corpus, fused and unfused.

## Later

- Block-domain tiling for fused groups (mlp's contractions).
- Split-K and tree reductions, tensor cores, reduced precision — the schedule already names the reduction axis,
  so a later pass can bind parts of it to blocks; none of this stage's certificates would survive that
  unchanged, which is why it is a later stage's job to extend them.
- Per-shape tile choice at launch; register patches in block mode; double-buffered block-mode tiles.
- A cost model checked against measurement, in place of the coalescing rule and the fixed sizes.
