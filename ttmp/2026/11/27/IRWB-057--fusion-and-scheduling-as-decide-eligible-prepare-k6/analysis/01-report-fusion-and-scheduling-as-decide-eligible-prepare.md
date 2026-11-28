---
Title: 'Report: fusion and scheduling as decide, eligible, prepare'
Ticket: IRWB-057
Status: active
Topics:
    - tensor
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-28T00:09:08.730633954-05:00
WhatFor: ""
WhenToUse: ""
---

# Report: fusion and scheduling as decide, eligible, prepare (IRWB-057, K6)

## Result

Fusion and loop scheduling are now two transformations of the schedule IR that each take a plan as their
parameter. An untrusted function decides the plan, `eligible` checks it, `prepare` applies it, and one `ensures`
check confirms that the candidate is the plan. The scheduling rule is a strategy plan of four nodes run under
`executeSync`. The CUDA runtime and the lowering contract read gate names and variant counts from a manifest
printed with the source; the regex is deleted.

**The decision point: K6's unification holds for this pair.** Both checks have the signature
`(schedule: Schedule, plan: P) => CheckResult` and are the `eligible` of a `Transformation<Schedule, {}, P>`:

```ts
fusePass:  eligible(schedule, plan: FusionChoice)   // fusionEligible(schedule.fn, plan)
loopsPass: eligible(schedule, plan: LoopPlan)       // loopsEligible(schedule, plan)
```

It holds because fusion became a transformation of the schedule IR. A schedule now starts as stage 2's one
pointwise kernel per statement, and `fusePass` regroups it. Before, fusion was a function from a Tix function to a
`FusionPlan` that built the first schedule, so it had no IR revision to be eligible on. The simpler alternative,
keeping `planFusion` outside and checking its result with a free function, would have given two signatures
(`(fn, plan)` and `(schedule, plan)`) and left fusion outside the runner.

## What the plans are

| | plan (serializable) | decide (untrusted) | eligible (trusted) | size of eligible |
|---|---|---|---|---|
| fusion | `FusionChoice`: per kernel, the statements and the depth of the block domain (with the reasons and refusals as notes the check does not read) | `chooseFusion` in strategy.ts: `decideFusion` (the greedy `joinDepth` rule), and the regrouping that keeps tileable contractions out of block mode | `fusionEligible`: the groups are the statements in order; one domain of equal extents; every read of a member has distance zero in the domain (`distanceVector`) | 41 lines |
| loops | `LoopPlan`: per contraction kernel, every variant's loops (order, level, factor, binding), staged tiles, and the launch rule | `chooseLoops` in strategy.ts: variant 0 and one tiled variant per entry of `tiles` | `loopsEligible`: the kernel has a tileable contraction; each dim's level 0 takes the rest of the extent; bindings are unique and fixed where they must be; the accumulation dependence stays forward (`accumulationViolation`); tiles fit; the rule ends with an entry for every grid | 77 lines with `variantViolation` and `accumulationViolation` |

`prepare` derives the rest: for fusion, what each kernel stores, buffers, stages and writes in place
(`fusionPlan`, the second half of the old `planFusion`); for loops, the contraction form of the kernel.

## The extent-17 counterexample

T6's `orderViolation` enumerated the nest at three extent vectors with 11, 1 and 0 terms. A reduction strip-mined
by 16 with the inner loop outside (`r.1 r.0`) visits the terms in the source's order at all three and in the order
0, 16, 1, 2, ... at extent 17, where the f32 sum of `[2^24, -2^24, 0 x 14, 1]` is 0 instead of 1.

The replacement decides the order symbolically, with direction vectors (new in `src/stdlib/affine/directions.ts`,
85 lines):

- The contraction has one loop-carried dependence: term r of an output's sum reads the accumulator that term r - 1
  left. Its distance vector over (b, m, n, r) is (0, 0, 0, 1), computed with the library's `distanceVector`.
- Strip-mining a loop into (outer, inner) replaces the direction `<` by the two pairs `(=, <)` and `(<, *)`. This
  holds for every block size and extent, because quotient and remainder are unique.
- A nest is legal when every vector, read in nest order over the serial loops, has `<` as its first component that
  is not `=`, and has `=` at every parallel loop.

For `r.1 r.0` the vector `(<, *)` reads `(*, <)`: rejected, with the message
`loop r.1 is outside the loops that order it (nest b.0 m.0 n.0 r.1 r.0, dependence = = = < *)`. No extent is
sampled, so there is no extent the check has not seen. The simpler alternative, adding 17 and 33 to the simulated
extents, would have fixed this instance and kept the same hole at the next factor (a split by 64 needs extent 65).

Measured against an enumeration of the nest (`tests/tensor/plans.test.mjs`): over all 1,560 loop orders of three
small nests (r split in two levels, r in three, m and r split), `accumulationViolation` accepts exactly the 540
orders whose enumeration is in source order at every extent from 0 to twice the product of the factors plus one,
and rejects the other 1,020.

In the base commit the pass route already refused this permutation (`reorderPass.legal`); the hole was in the
output validator, which was the only check on a schedule that did not come from that pass (the rogue-pass test,
a hand-built schedule). Now there is one check, on the plan, and `conforms` rejects a `prepare` that produces
something else.

## Cost

Probe `scripts/02-schedule-cost.mjs` (median of 15 runs per program, memo bypassed), against a build of ab23152:

| program | before: ms, pass applications | after: ms, pass applications |
|---|---|---|
| attention | 383.7, 107 | 7.1, 2 |
| mlp | 294.5, 107 | 4.9, 2 |
| conv2d | 110.3, 53 | 2.7, 2 |
| matmul | 90.0, 53 | 2.7, 2 |
| layernorm | 0.4, 0 | 1.2, 2 |
| softmax | 0.2, 0 | 1.0, 2 |

The 53 applications per contraction kernel each built and diffed a schedule artifact and ran the order gate over
every variant. Programs without a contraction now pay about 1 ms for the plan's execution records, which they did
not have. `scheduleFunction` still computes each function once.

Source lines: schedule.ts 683 to 558, strategy.ts 146 to 220 (it now holds both decisions and the plan),
fusion.ts 330 to 421, directions.ts 85 new.

## The strategy plan

```
sequence schedule
  require decide-fuse   tensor.schedule.decide-fuse   as fusion
  apply   fuse          tensor.schedule.fuse          args: binding fusion
  require decide-loops  tensor.schedule.decide-loops  as loops
  apply   loops         tensor.schedule.loops         args: binding loops
```

The decisions are analysis algorithms; `require` binds their results and records them as evidence, so an
execution holds both plans as data. The plan round-trips through `serialize`/`deserialize`. `lowerSchedule(fn,
false)` is the initial schedule and runs nothing.

## The manifest

`emitScheduleProgram(schedule)` returns `{ source, kernels }`. A kernel entry is
`{ name, mapping, statements, gated?, variants? }`: a gated kernel has a `--gate` side and reports one choice byte
per case, in manifest order; `variants` is a contraction kernel's count. The emitter builds the entries with the
predicate that prints the gate (`gatedGroup`). The lowering contract stores the manifest as the CUDA unit's
`kernels` (which it already held, without `variants`) and passes it to the runtime; `takesGate`, `takesVariant`,
`variantCount` and the regex in `runCudaBatch` are deleted.

`src/tensor/index.ts` is outside this step's scope, and its `runTixCuda` passes the runtime only the source text.
For that caller the emitter keeps the manifests of the sources it printed, keyed by the source's SHA-256
(`emittedKernels`), and the runtime looks the source up when no manifest is passed. A source with neither is
refused before anything runs. **Proposed follow-up (one line in index.ts):** `runTixCuda` calls
`emitScheduleProgram` and passes `kernels`; then the table and the lookup can go.

## Machinery in the domain that the framework should provide

- **`planPass` (schedule.ts, 28 lines):** builds a transformation from `eligible(schedule, plan)`,
  `prepare(schedule, plan)` and `conforms(candidate, plan)`. This is K6's constructor and is domain-independent
  (a `decision({ eligible, prepare, conforms })` beside `transformation`). I built it in the domain because
  `src/framework/` is closed to this step. Second use: the binding-time divisions of IRWB-058, Typed inlining.
- **The decisions as `analysis` algorithms:** the strategy IR has no node for "decide, then apply with the
  result"; `require` plus `binding` expresses it exactly, so nothing is missing, but the algorithm kind says
  `analysis` for what is a choice.
- **A no-op `prepare` is not seen by `ensures`:** the runner returns `unchanged` before the obligations when the
  candidate equals the input, so `conforms` cannot reject a `prepare` that ignores the plan and returns the input.
  The published state is still legal (it is the input); the plan was not applied and nothing says so. A
  decision constructor in the framework could check conformance before the unchanged exit.

## Existing tests changed

- `tests/tensor/schedule.test.mjs`: "each pass refuses an illegal step" became "eligible refuses an illegal loop
  plan" (the same refusals, now of a plan: reduction order, a parallel reduction loop, an unfixed unroll, a stage
  outside r, the launch rule; plus coverage, double binding, tile size, a kernel without a contraction). "the
  order gate rejects a step that changes any output accumulation order" became "a prepare that does not realize
  the plan is rejected" (the same swapped-levels rogue, rejected by `conforms`, and the plan it realized rejected by
  `eligible`). The corpus test's `accumulationOrder` assertion is `accumulationViolation(v) === undefined` for
  every variant, and `scheduleFunction(fn, plan, false).steps` is `scheduleFunction(fn, false)`. These asserted
  the per-pass `legal` checks and the order gate, which this step replaces.
- `tests/tensor/fusion.test.mjs`: `takesGate(source)` became the manifest (`emittedKernels(source)`), which
  asserts more (the kernel's statements and mapping).
- `tests/tensor/fusion-gpu.test.mjs`, `terms-gpu.test.mjs`, `schedule-gpu.test.mjs`: the hand-written kernel list
  of a mutant candidate gained `gated: true` or `variants: 4`. The contract used to read both from the mutant's
  source; a candidate now states them.

## Left out, and what I believe is weak

- **`fusionEligible` accepts groupings that `decideFusion` never makes** and the printer has not printed: a member
  that reads no other member (horizontal fusion), and a domain shallower than the deepest legal one. They are
  legal by the dependence argument; the printer's handling of them is checked only by the GPU contract.
- **The derived layout is not checked by `eligible`.** `fusionPlan` chooses staged rows, term staging, in-place
  rows and `heavy` from the grouping. `conforms` compares statements and depth only. A wrong layout is caught by
  the GPU differential, as before.
- **`directions.ts` has one client** (the Tix loop plans) and its test; the library's admission rule asks for two.
  The second would be a loop transformation in Typed (interchange or strip-mining in `speed`), which no step has.
- **Correspondence is coarser.** The per-step passes recorded `split` and `renamed` entries per loop; one
  transformation records the kernel as retained and its variants, loops and stages as inserted.
- **`CudaIR` stays at version 3** although a kernel entry gained the optional `variants`; the units of programs
  with contraction kernels have new revisions (not in the baselines).
- **The brief** says every Tix pass has been a `Transformation` since phase 3; the schedule passes were still in
  the `definePass` spelling with `applyNativePassSync`. With them gone, `definePass` and `applyNativePassSync` have
  no caller in `src/` outside the framework (tests only).

## Later

- `runTixCuda` passes the manifest; delete `emittedKernels`.
- `decision(...)` in the framework, with conformance before the unchanged exit.
- A launch-time variant with its guard as staged choice (the migration's last step), from the manifest's `gated`
  and `variants`.
- Loop plans for kernels other than two-operand contractions.
