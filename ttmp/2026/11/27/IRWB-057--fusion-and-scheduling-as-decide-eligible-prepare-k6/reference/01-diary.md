---
Title: Diary
Ticket: IRWB-057
Status: active
Topics:
    - tensor
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-28T00:09:07.713934301-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: reading, and a schedule oracle before any change

Read the brief, R3's K6 panel, worked defect 5 and reviewer B's probe. Read fusion.ts, schedule.ts, strategy.ts,
the CUDA emitter's host part, the runtime and the lowering contract, `transformation.ts`, the strategy IR and the
bridge.

What I found that shaped the design:

- `Transformation.eligible(ctx)` already receives `params`. A plan as the parameter needs no framework change.
- The strategy IR's `require` node binds an analysis result and `apply` takes `args: binding(name)`. So "decide,
  then apply the decision" is expressible in a plan, and the decision lands in the execution records.
- `index.ts` (closed to this step) passes `runCudaBatch` only the source text.
- The lowering contract's CUDA unit already carries a kernel list with `gated`: most of a manifest.

Wrote `scripts/01-schedule-oracle.mjs` before touching code: for the corpus, the fixtures and every program
written inline in the tensor tests (92 sources, also after `inline` and `inline, split-sum`), fused and unfused,
it records the SHA-256 of the CUDA source and the schedule's kernels as JSON. 310 schedules: 378 pointwise, 58
rows, 22 contraction kernels. The coordinator's baselines cover the six corpus programs; this covers the test
programs too and the schedule values, key order included.

## Step 2: direction vectors in stdlib/affine

`directions.ts`: `direction` (sign of a constant distance), `stripMine` (the direction pairs of outer and inner),
`orderViolation` (lexicographic non-negativity over the serial loops, `=` at parallel loops). Stated from Allen
and Kennedy. The strip-mining rule is the part that answers extent 17: `<` becomes `(=, <)` or `(<, *)` for every
block size, and `(*, <)` is not non-negative.

## Step 3: fusion split in three

`planFusion` was one function. Its first half (the greedy runs) is `decideFusion` and returns a `FusionChoice`;
its second half (stored, buffered, staged, terms, in place) is `fusionPlan(fn, choice)`. `fusionEligible` is new
and uses `distanceVector` like `joinDepth`, but as a check of a given grouping, not a search. `planFusion` remains
as the composition, so its 20 test call sites did not change.

## Step 4: schedule.ts, the two plan transformations

Deleted the eight per-step passes, `simulate`, `orderViolation`, `accumulationOrder`, `orderGate`, `applyStep`.
Added `planPass`, `fusePass`, `loopsPass`, `loopsEligible`, `accumulationViolation`, `contractionOf`.
`initialSchedule(fn)` is now the unfused schedule. The old isolate pass (fission) is part of the fusion decision
(`chooseFusion`), since it was a second `planFusion` with `noBlock`.

First build: `tsc` clean, oracle `no differences (310 schedules)`. The loop objects the decision writes directly
have the key order the split, reorder and bind passes produced.

## Step 5: the manifest

`emitProgram` returns the source and the kernel entries; `gatedGroup` is the one predicate for printing a gate and
for `gated`. Moved `CudaKernel` to cuda-source.ts, added `variants`. `modesOf` in the contract takes the kernel
list. `runCudaBatch` takes `kernels`, or finds the manifest of a source this process printed. Deleted `takesGate`,
`takesVariant`, `variantCount` and the regex.

What failed: the first test run stopped at `fusion.test.mjs` importing `takesGate`. Replaced by the manifest.

## Step 6: tests

`tests/tensor/plans.test.mjs` (6 tests): the extent-17 variant; `accumulationViolation` against an enumeration on
1,560 loop orders; every plan of 100+ functions eligible and round-tripped through JSON to the same schedule
revision; the strategy plan through `serialize`; fusion refusals; the manifest. Three stdlib tests for the
directions. Rewrote two tests of schedule.test.mjs and adjusted the others listed in the report.

Mistakes on the way: I expected the rejected vector to print as `< >` (it is `< *`), wrote a test program whose
transposed result had the wrong shape, and assumed an axis id. My first draft of the conformance test used a
`prepare` that returned the input: the runner reports that as unchanged before `ensures`, so `conforms` never
ran. The test now uses a `prepare` that returns a different wrong schedule; the gap is in the report.

## Step 7: acceptance

On 61e4f67 (the commit with all source and test changes):

- non-GPU tensor tests and stdlib: 102 pass, 0 fail;
- `tests/typed`: 186 pass, 0 fail (188 tests, 2 skipped); `tests/framework`: 259 pass; `tests/workbench`: 24 pass
  (25 tests, 1 skipped); `tests/stdlib`: 51 pass;
- GPU suite, one file at a time (`--test-concurrency=1`): 23 pass, 0 fail, 256 s;
- baselines: `no differences`;
- `npm run check` clean; `node tools/build-site.mjs` built;
- `npm run format:check` warns about 8 files, none of them changed by this step.

Probe 02 (scheduling cost) ran against a build of ab23152 exported to the scratchpad: attention 384 ms to 7 ms.
