---
Title: A schedule IR between Tix and CUDA, and exact tiled contractions through it
Ticket: IRWB-033-G
Status: active
Topics:
    - tensor
    - gpu
    - compiler
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/schedule.ts
      Note: The schedule IR (v6 artifact), its adapter, the build from the fusion plan and the contraction analysis
    - Path: repo://src/tensor/schedule-passes.ts
      Note: The scheduling passes, their legality and the accumulation-order analysis they are checked by
    - Path: repo://src/tensor/schedule-strategy.ts
      Note: The rule that picks a schedule for a function
    - Path: repo://src/tensor/cuda-source.ts
      Note: The emitter prints the schedule; the tiled contraction kernel and its launch-time choice
    - Path: repo://src/framework/passes/define-pass.ts
      Note: A pass may now read an artifact of another IR kind (source adapter)
ExternalSources: []
Summary: A schedule IR between Tix and CUDA; the fusion plan feeds it, scheduling passes refine it, an accumulation-order analysis checks every step without the GPU, and a strategy picks the tiling. The tiled contraction keeps each output's k order and is ~3.8x faster than the current lowering at 512^3.
LastUpdated: 2026-11-27T10:30:00-05:00
WhatFor: Design of stage 6 before implementation
WhenToUse: Reviewing the schedule IR, its passes, the order check and the tiling strategy
---

# A schedule IR between Tix and CUDA, and exact tiled contractions through it

## Goal

Until now every lowering decision lived in a plan (`planFusion`) and an emitter (`emitCuda`): the plan was
unchecked in the middle, and no step of the lowering could be looked at on its own. Stage 6 puts a **schedule IR**
between Tix and the CUDA source. The fusion plan feeds it, scheduling passes refine it, an analysis checks what each
pass preserved, and the emitter only prints it.

The second goal is speed you can rely on: a contraction (`c[i,j] = sum(k) a[i,k] * b[k,j]`) currently reads two
floats from global memory per multiply-add and takes 0.20 ms at 512³, 6× slower than cuBLAS's 0.0329 ms. A tiled
contraction reaches 0.064 ms, and no result bit changes.

## Domain

The schedule IR, its passes and the strategy cover:

- every function the checked Tix core accepts, at every shape the core accepts: shape symbols arbitrary
  nonnegative sizes, including 0 and 1 extents, and non-multiples of any tile size;
- for a **tiled contraction**, one more restriction, decided from the IR: the kernel computes exactly one member,
  mapped thread-per-element (not the block mode of stage 3), that member has rank 2 with a single outermost
  reduction, and the reduction's body is a product of exactly two tensor reads in which the reduction axis has
  coefficient 1 and every other index is the member's own output axis at that position (so `a[i,k]`,
  `b[k,j]`, `b[j,k]` all qualify; a shift such as `a[i,k+1]` qualifies too, an `a[i,k*2]` does not).
  Anything else keeps the stage-3b schedule, unchanged.

Inputs are the core's: finite f32 words, consistent extents, in-bounds reads. Nothing here adds a check for an
input that violates them.

## The schedule IR

An artifact of kind `tensor.schedule` (v1) holding one function's kernels. It is plain JSON, an adapter projects it
as entities (`k0`, `k1`, … kernels; `fn/member` per member) with containment and reads relations.

```
ScheduleFunction { fn, source: {artifact, revision}, kernels: ScheduleKernel[], refusals, termRefusals }
ScheduleKernel {
  name, mapping: 'thread' | 'block',
  members: string[],                    // Tix statement names, in order
  stored, buffered, staged: string[],   // where each member's values live
  terms: {statement, reduction}[],      // whose terms all threads compute
  inPlace: {statement, over}[],         // which row buffer a member is written over
  heavy: string[], gated: boolean,      // what the launch-time gate counts
  threads: {rule: 'rows'|'contraction'|'heavy', cap},
  contraction?: ContractionSchedule,    // present only for a tiled contraction
  reasons: string[]                     // why, in the IR, for the report and the tests
}
ContractionSchedule {
  statement, reduction,                 // which reduction is tiled
  block: [BI, BJ],                      // outputs per block
  lane: [TM, TN],                       // outputs per lane (a register patch)
  kTile: KC,                            // reduction terms per pass over the operands
  stage: ['a','b'] | subset,            // operands copied into shared memory
  buffer: 'single' | 'double'
}
```

The kernels and everything in them except `contraction` are the stage-3b fusion plan's constructs, now artefacts
rather than a plan: `mapping`, `members`, `stored`, `buffered`, `staged`, `terms`, `inPlace`, `heavy`, `gated`.

**Why the fusion decisions feed the IR instead of becoming passes.** Stage 3's group rule is a whole-function
analysis: it decides which *statements* share a kernel, from reads, extents and reduction positions. A pass over a
schedule IR cannot make that decision, because by then the statements are already placed in kernels; and a pass
that could move statements between kernels would need the whole-function analysis anyway. So `planFusion` stays as
the front half of the pipeline and `schedule-build` turns its groups into kernels, with a correspondence from
statements to kernels. 3b's staged terms and its gate are constructs of the kernel (`terms`, `heavy`, `gated`),
because they are properties of one kernel's mapping. What this costs: the two artifacts hold the same statements
(by name — the schedule names the Tix revision it schedules, and the emitter resolves bodies through it). What it
buys: everything after the build is a checked pass on one kernel.

## Scheduling steps are passes

`src/tensor/schedule-passes.ts`, each a `definePass` over `tensor.schedule` with declared `writes`, a legality
decision made from the IR before it is applied (a refusal throws before any revision exists), and the
entity correspondence the framework derives from the before/after projections:

| Pass | What it writes | Legality, decided from the IR |
| --- | --- | --- |
| `tensor.schedule-build` v1 | everything (Tix → schedule) | the plan's own rules; every statement lands in exactly one kernel |
| `tensor.schedule-tile-domain` v1 | `contraction.block`, `contraction.lane` | tiled-able contraction (above); `TM | BI`, `TN | BJ`, `1 ≤ BI·BJ/(TM·TN) ≤ 1024` lanes and a multiple of 32 |
| `tensor.schedule-tile-reduction` v1 | `contraction.kTile` | the reduction is an outermost one, its axis is read only inside its body, `kTile ≥ 1` |
| `tensor.schedule-stage-operand` v1 | `contraction.stage`, `contraction.buffer` | tiling exists; a staged operand is read with the reduction axis at coefficient 1; two buffers need `2·(BI·KC + KC·BJ) ≤` the device's opt-in shared memory (from the IR's tile sizes against a recorded device limit) |

`schedule-build` is the cross-kind pass: its input artifact is a `tensor.tix` artifact and its output a
`tensor.schedule` artifact. The framework did not express that (a pass was an endomorphism on one IR kind: the view
of the input was opened with the pass's own adapter), so `PassSpec` gains an optional `source: {ir, adapter}`.

## Each step is checked twice

**Without the GPU.** `tensor.accumulation-order` is an analysis over the schedule IR: for every kernel, member and
outermost reduction it returns the *visit order of the reduction's indices as the emitted code will run it*,
flattened to a canonical form. An untiled reduction over `k` of extent `K` is
`[k: 0 → K-1, step +1]`. A tiled one is `for k0 = 0, KC, … : for k = k0 … min(k0+KC, K)`, which flattens to exactly
the same sequence. Every scheduling pass is applied through a gate that recomputes the analysis on the output and
compares it word for word with the input's, so a pass that reordered a reduction is rejected before the run exists.
The canonical form cannot express a split-K or a tree: a parallel axis before `k` would appear as an axis of its
own and compare unequal. That is the forbidden reassociation caught structurally, without the GPU.

`kTile` therefore *is* the strip-mine loop, not a split: `k0` climbs and `k` climbs inside it, one accumulator per
output element across both, so the sequence of `(mul, add)` pairs per output is the meaning's.

What this covers: the order in which the emitted schedule visits a reduction's terms, for every kernel in the IR.
What the GPU check still has to cover: that the printed code visits the terms in the order the IR says (the emitter
is not verified), that the tiles are copied and indexed correctly, that the accumulator is one register per output
across tiles, guards, and the arithmetic itself.

**With the GPU.** `checkLowering` is unchanged in shape: the differential check against the current revision's f32
meaning under the exact relation, NaN as a class. A source with a tiled contraction takes `--tile=tiled|plain` to
force a side, exactly as a gated source takes `--gate=fused|unfused`, and the case list covers both sides, so the
tiled instantiation is checked on every sample even though the samples are small and the launch rule would pick the
plain side.

## The strategy

`src/tensor/schedule-strategy.ts` runs the passes in order over the built schedule and returns the schedule and the
list of steps taken (pass, parameters, legality, whether it changed anything):

1. `schedule-build` with `fuse` as the caller asked;
2. for each kernel that is a tiled-able contraction: `tile-domain 64×64 / 4×4`, `tile-reduction 32`, `stage` both
   operands, single buffer.

That is the whole rule: no timing, no candidate search. It is a function of the IR.

**Why a static tile size.** The extents are symbolic at compile time (`M`, `N`, `K`), so the choice is either a
static size or a launch-time choice between instantiations. The measurements (probe 01, one session, medians of
three) say the best size is shape-dependent: 64×64×32×4×4 gives 0.0637 ms at 512³ and 18.9 ms at 4096³, while
128×128×32×8×8 gives 0.125 ms and 15.8 ms. Two instantiations chosen at launch by `M·N·K` would give both, at the
cost of a second body in the kernel and a second forced side in the contract. This stage keeps one static size —
the smallest change that reaches the goal at 512³ — and records the launch-time choice as the obvious next step.

**Why the tiled kernel is chosen at launch, not always.** For small contractions the tiles are pure overhead: at
64³ and 128³ the tiled kernel is 2.0 and 1.7 times slower than the per-element mapping, at 224³ 1.14 times slower,
and at 256³ 0.86 times faster. So the host picks, from the shape values, `M·N·K ≥ 1.5·10⁷` for the tiled body and
the per-element body otherwise. Both bodies are in one `template <bool Tiled>` definition, so the kernel count does
not change. The threshold sits between the last measured loss (224³ = 1.12·10⁷) and the first measured win
(256³ = 1.68·10⁷).

**Why not `src/framework/strategy`.** Its interpreter is asynchronous (`S.execute` returns a promise for a trace),
and its algorithms exchange plain JSON with a registry keyed by `(id, version)`. The lowering must stay synchronous
(`cudaSource` is a synchronous export) and its steps exchange frozen, content-addressed artifacts whose identity is
part of the evidence. `scheduleStrategy` therefore keeps the same shape — an ordered plan of named versioned steps
with parameters, each applied through `applyNativePassSync` with its own legality and check, each returning the
framework's own `PassResult` (changes, correspondence, edits, gate) — without the interpreter. A test runs the same
passes through the framework's asynchronous path (`applyPass` with `preserves: [accumulationOrder]`) and confirms
the framework's preservation check accepts them, so the passes are v6 passes and not a private mechanism.

## The tiled contraction kernel

Printed from `ContractionSchedule`, one block per `(BI, BJ)` output tile, one lane per `(TM, TN)` patch:

```
for k0 in 0, KC, … :
   copy a's tile [BI][KC] and b's tile [KC][BJ] into shared memory (bounds-guarded, 0 outside)
   barrier
   for k = k0 … min(k0+KC, K):            // the meaning's order, one accumulator per output
      a register value per output row, b per output column
      acc[m][n] += a[m] * b[n]            // __fmul_rn then __fadd_rn, never fused
   barrier
store the patch, bounds-guarded
```

The operands are read through the same affine address code the rest of the emitter uses, so a transposed or shifted
operand needs nothing new; only the tile layout in shared memory is fixed (`[BI][KC]`, `[KC][BJ]`), whatever the
operand's own layout. An epilogue around the reduction (`(sum(k) …) + bias[j]`) is the existing expression walk with
the tiled reduction returning its accumulator.

## Refused, with the reason

- **Reassociation of any kind** (split-K, tree reductions, parallel max): exact would still be reachable for max,
  but the order analysis rejects the shape of the loop nest, which is the point of having it.
- **FMA, tensor cores, reduced precision**: different bits or a different problem; a later stage.
- **Vector loads and stores** (`float4`): implemented as a schedule field only if a pass can be checked for it;
  measured first, and in probe 01 vector loads were 0.0756 ms against 0.0637 ms at 512³ (KC = 32), so the strategy
  does not choose them. A schedule step that no rule selects is not worth its check.
- **Double buffering**: it needs a prefetch that overlaps the copy with the arithmetic (an `async` copy or a
  rotated buffer the compiler can software-pipeline). With two barriers per k-tile the copy of the next tile cannot
  overlap, which is why KC = 32 rather than 8. Not measured separately; recorded as later work.
- **Tiling the block-mode groups** (attention, mlp, conv2d): they are one block per row, so the operands' reuse
  inside a block is bounded by the row, and a fast version needs several rows per block — new row-buffer layouts
  and a block-domain tile, i.e. a bigger change than this session has room for. Theirs stay stage 3b's kernels,
  byte for byte.
- **Tile sizes chosen by timing** (autotuning): outside the stage.

## Framework and tool changes planned

1. **`define-pass.ts`: a pass may read another IR kind** (`PassSpec.source`). Reason: the Tix → schedule step is a
   pass whose input is not of its own kind; the framework opened the input with the pass's adapter, so a cross-kind
   pass failed validation.
2. Nothing else is expected; anything further is recorded when found.

## What will be measured

- matmul at 512³ and 4096³ and the contractions inside attention, mlp and conv2d, fused and unfused, under the
  brief's timing protocol (five `benchmark` calls, alternating variants, 5% treated as noise), with TFLOP/s and the
  ratio to cuBLAS.
- every corpus program, fused and unfused, against the base, so that nothing got slower.
- the order analysis: what it rejects (a mutant that reverses the inner loop, a split-K schedule), and what it costs.
- the contract: cases and wall time per program with a tiled contraction, with both sides forced.
