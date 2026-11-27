---
Title: A schedule IR between Tix and CUDA, with exact tiled contractions
Ticket: IRWB-033-I
Status: active
Topics:
    - tensor
    - gpu
    - compiler
    - ir
    - scheduling
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/schedule.ts
      Note: the schedule IR, its validator, and the initial schedule built from the fusion plan
    - Path: repo://src/tensor/schedule-passes.ts
      Note: tile, bind and unroll as v6 passes over the schedule IR
    - Path: repo://src/tensor/cuda-source.ts
      Note: the emitter prints a schedule; the tile-mode kernel emitter
    - Path: repo://src/tensor/schedule-pipeline.ts
      Note: the checked Tix to schedule to CUDA chain with composed correspondences
ExternalSources:
    - arXiv 2609.11356 (Yang, Riasanovsky, Deng, Sarkar 2026)
Summary: Tix lowers through a schedule IR artifact; tile, bind and unroll passes choose shared-memory tiles, register patches and chunked reductions for contractions; every output element keeps the meaning's term order.
LastUpdated: 2026-11-27T10:40:00.000000000-05:00
WhatFor: Design of stage 6 before implementation
WhenToUse: Reviewing the schedule IR, its passes, and what the contract checks
---

# A schedule IR between Tix and CUDA, with exact tiled contractions

## Goal and domain

Contractions are slow because one thread per output element loads two floats from global memory per
multiply-add (matmul 512³: 0.21 ms against cuBLAS 0.0329). Stage 6 makes contractions fast **without
changing any result bit**, and restructures the compiler: a **schedule IR as a v6 artifact between Tix
and CUDA**, with scheduling decisions made by **passes on the schedule IR**, each with its own legality
and correspondence. The domain is stage 3b's: any function of the checked core, called with consistent
shapes, finite inputs, in-bounds reads, sizes the GB10 can allocate and launch. Not in this stage:
reassociating a reduction (split-K, tree reductions), FMA contraction, tensor cores, autotuning by
measured search.

**The invariant every schedule must keep.** Each output element accumulates its terms one at a time in
the meaning's order (reduction axes ascending, first axis outermost, chunk-major after a chunk split),
rounding the product and the sum separately (`__fmul_rn`, then `__fadd_rn` or the max fold). A staged
copy moves words unchanged; a register accumulator belongs to exactly one output element and is only
touched by that element's own k sequence.

## The schedule IR (`tensor.sched`, version 1)

A schedule value describes the kernels of one Tix function and, for every member statement, how its
elements are laid out on the machine. It is a frozen JSON record, checked by a validator.

```
ScheduleUnit {
  fn: string
  kernels: SchedKernel[]          // in launch order
}
SchedKernel {
  id: string                      // k0, k1, ...
  statements: string[]            // member statements in source order
  depth: number                   // block-domain rank (leading shared axes); 0 for tile kernels
  mode: 'thread' | 'block' | 'tile'
  gated: boolean                  // the host decides at launch between this kernel and stage 2's code
  threads?: number                // block and tile mode: threads per block
  // block mode, unchanged from stages 3/3b (rows in buffers, staged rows, staged terms, in place):
  staged/buffered/inPlace/terms/heavy: as FusionGroup has them
  tiles?: TileMember[]            // tile mode: one entry per member
}
TileMember {
  statement: string
  block: number[]                 // block-tile extent per output axis (last axes; a leading axis of a
                                  // multi-statement tile kernel is covered whole, so its extent entry is 0)
  patch: number[]                 // per-thread patch per output axis (registers)
  strides: number[]               // reduction chunks per outermost reduction (preorder): 0 = not tiled
  stage: { tensor: string; dims: TileDim[] }[]   // operand tiles staged per chunk
}
TileDim { axis: number; extent: string; kind: 'block' | 'chunk' | 'halo' }
```

The initial schedule is built from the fusion plan (`planFusion`, stages 3/3b, unchanged): each group
becomes a kernel; thread groups get mode `thread`, block groups mode `block` with their staging, terms,
in-place rows, heavy members and gate. Stage 2 (`fuse: false`) is the schedule built from
`unfusedPlan` with no passes; its bytes are unchanged and the digest test still passes.

**The emitter makes no decisions.** `emitCuda(fn, schedule)` prints what the schedule says: mappings,
tile and patch sizes, chunk sizes, staged layouts, vector widths, thread counts, unroll flags, the
gate. Everything it printed by deciding before now comes from a field of the schedule.

## The pipeline

```
Tix artifact --tensor.plan-schedule--> schedule r0 --tile--> r1 --bind--> r2 --unroll--> r3
             --tensor.emit-cuda--> CUDA artifact
```

- `tensor.plan-schedule` is a transformation (Tix → schedule) whose correspondence maps each Tix
  statement to its schedule member (one to one).
- Each schedule pass is a `definePass` on the schedule adapter. It decides legality from the schedule
  value and the Tix function it names, transforms the value, and the framework diffs the two revisions,
  checks the declared writes and derives the entity correspondence (members to members).
- `tensor.emit-cuda` is a transformation (schedule → CUDA) with the `kernels` correspondence (members
  to kernels, as today).
- `checkLowering` runs the chain and **composes the correspondences** (`composeCorrespondence`) into a
  statement → kernel record over Tix → CUDA, then runs the existing exact meaning invariant on the final
  CUDA artifact. Each pass is thus checked twice: its own contract when applied, and the whole chain
  bit for bit against the f32 meaning on the GPU.

Every pass records its decision and its refusals with reasons in `plan.refusals`-style evidence kept on
the schedule value, so the report and the tests can name what was refused and why.

## The tile pass (contractions)

**Where.** For each kernel, the pass partitions its members into maximal runs of equal shape. A run is
**tileable** when (checked from the IR, each failure a recorded refusal):

1. every read of a member of the run, by a member of the run, is at that reader's own indices (a
   register or in-tile read);
2. the run contains an outermost reduction whose body reads a tensor from global memory (a parameter
   or an earlier kernel's output) — otherwise tiling buys nothing;
3. for every such reduction r and every tensor t read inside r: at each position p of t's indices,
   the index is either exactly one of r's reduction axes, or an affine form in output axes only. A
   position mixing an output axis with a reduction axis (conv2d's `y + dy`) is refused: the tile would
   need a halo the schedule does not express yet (recorded; a later stage can add halo tiles);
4. the run's tile fits the block's shared memory at the chosen sizes, with the gate covering the rest.

A tileable run leaves its kernel and becomes a **tile kernel** (mode `tile`, depth 0): one block per
tile of the run's output space; members run in order inside the block; a member with no reduction
chains on the previous members' registers; each reduction gets chunked k loops and staged operand
tiles. The remaining members keep the kernel they were in, block or thread mode, and read the run's
outputs from global memory (their staged-row mechanism already copies from a global tensor).

- matmul (one statement): the whole group becomes one tile kernel.
- mlp: runs `[h,g]` (equal shapes) and `[y]`; both tileable → three kernels become two: `[h,g]` tiled
  (h's accumulator registers feed g's tanh directly, so h is never written to memory), `[y]` tiled.
- attention: runs `[score] [shift] [e] [z] [weight] [out]`; `score` and `out` are tileable → three
  kernels; whether `score` should leave the row kernel is measured (the rule may keep it, see below).
- conv2d: refused by rule 3 (halo); keeps its current schedule and speed.
- softmax, layernorm: no tileable run; unchanged.

**How a tiled reduction runs.** The reduction's first axis is split into chunks of BK (`blocks` extent,
then a `tail` remainder, exactly Tix's own split shape, so the emitter reuses its bound logic):

```
acc[patch] = init                                  // one register per patch element
for each full chunk (b = 0 .. floor(E/BK) - 1):
    stage t's chunk tile cooperatively (guards: output index within shape, chunk index within extent)
    __syncthreads()
    for kk in 0..BK:  for each patch element:  acc = fold(acc, term at (patch, b*BK + kk))
    __syncthreads()
if E mod BK:
    stage the guarded remainder tile; __syncthreads()
    for kk in 0..rem: for each patch element: acc = fold(acc, term at (patch, nFull*BK + kk))
    __syncthreads()
epilogue: the member's expression with each reduction subtree replaced by its acc register
store the patch elements that are inside the shape
```

Per output element the term sequence is the meaning's: k ascending across chunks (chunk-major, tail
last), inner axes in order, product rounded, sum rounded. The staged tile holds the same f32 words the
direct loads would have read. Registers are per (thread, patch element), so no accumulator is shared.

**What the GPU check still has to cover.** The order argument is about term sequences; the GPU samples
cover what the IR cannot show: that the cooperative staging writes the tile element a later read names
(the tile arithmetic), that patch decomposition and tile decoding cover every output element exactly
once, that guards keep out-of-range reads in bounds, and races (two syncs per chunk). A schedule-level
mutation test (swap a tile index in the IR before emission) exercises exactly this layer.

## The bind and unroll passes

- **`tensor.sched.bind`** sets `threads` from the tile: threads = (block/patch product over the tiled
  axes arranged last-axis-fastest), rounded to a warp, at most 1,024. Legality: patch divides block
  per axis; patch nonzero. It also sets each staged tile's vector width: 4 when the chunk extent and
  the tensor's row stride are both multiples of 4 (alignment is a launch property, so the gate
  re-checks it and falls back to the scalar instantiation otherwise).
- **`tensor.sched.unroll`** flags the patch loops and the fixed-length chunk loop for `#pragma
  unroll`. Legality: the loop extent is a compile-time constant and small (≤ 8 per axis).

## The rule that picks the schedule (strategy)

The pass parameters are chosen by a deterministic rule from the schedule structure, before any
measurement: one tile configuration per tiled run, chosen from the reduction and output structure
(when a candidate configuration's measured crossover is known, the rule encodes it; the gate keeps the
launch-time safety net). The brief asks whether `src/framework/strategy` fits. Plan: express the choice
as a strategy plan — `fork` over candidate configurations, an IR-level cost model as the metrics
algorithm (arithmetic at the FMUL+FADD ceiling, staged traffic at measured bandwidth, no timing),
`chooseBest` with direction `min`. If the framework's JSON-only values or its all-candidates execution
make this awkward for pass parameters, the fallback is the plain rule function and the report says
where the strategy did not fit. This is decided during implementation and recorded either way.

## Measurements planned

- Matmul 512³ and 4096³, attention's `out` (and `score` variant), mlp's two contractions, conv2d as
  refused: fused and unfused, median of 5 alternating `benchmark` calls, TFLOP/s, ratio to cuBLAS.
- Every corpus program fused and unfused against the base, so nothing got slower.
- The gate crossover for tile kernels (when tile mode loses to stage 2).
- Config sweep: (BM, BN, BK, TM, TN, thread arrangement) over a small grid, measured, rule fixed from
  the table.
- Contract cost per program.

## Framework changes expected

- `CudaIR` version 3: `mapping` gains `'tile'`.
- Everything else should fit the existing framework (transformation, definePass, composed
  correspondences, the differential with forced gate sides). Any friction is a finding to record.

## Later

- Halo tiles for stencils (conv2d).
- Double buffering (the IR leaves room: a `buffers: 2` field on a chunk).
- Launch-time choice among tile configurations (templates per config).
- Reassociation-free split-K is still out of scope; the schedule's chunk loop is where it would go.
