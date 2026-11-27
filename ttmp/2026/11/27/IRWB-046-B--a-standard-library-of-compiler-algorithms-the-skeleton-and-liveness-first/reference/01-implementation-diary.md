---
Title: Implementation diary
Ticket: IRWB-046-B
Status: complete
Topics:
    - compiler
    - ir
    - typescript
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Diary of IRWB-046-B
LastUpdated: 2026-11-27
WhatFor: "The step-by-step record of the standard library skeleton and the liveness primitive."
WhenToUse: "Resuming or reviewing IRWB-046-B."
---

# Implementation diary

## Step 1: ticket, orientation, design (2a2e015)

- Read the IRWB-039 design doc's phase 2 (admission rule, layering D, 2b liveness), the framework
  solver (`src/framework/dataflow/solver.ts`: entry-reachable, unreachable blocks keep bottom), and
  the two hand-written sweeps: `intervals` in `backend/regalloc.ts` and the head of
  `coalesceCopies` in `backend/coalesce.ts` — line for line the same fold plus backward sweep.
- Design committed (design/01): a `LiveBlock`/`LiveGraph` interface (per-block upward-exposed uses,
  defs, successor indices; optional entry, default 0), a *required* `LivenessScope` parameter
  ('all-blocks' vs 'entry-reachable'), `src/stdlib/` with `flow/liveness.ts` now and the later
  modules as one line each in `index.ts`. Scope choice: both machine clients pass 'all-blocks'
  (their sweeps always ran over every block; byte-identical images require it); the framework's
  solver stays entry-reachable.

## Step 2: the primitive, the two clients, the tests

- `src/stdlib/flow/liveness.ts`: the sweep moved as it was (backward sweeps, size-as-equality
  change test — sound because facts only grow), with `reachableBlocks` for the entry-reachable
  scope. `src/stdlib/index.ts` is the index: what exists, the layering rule, one line per later
  module (`graph`, `lattice`, `num`, `flow`'s solver, `ssa`, `term`, `affine`, `pe`, `check`,
  `measure`).
- `regalloc.ts` `intervals` and `coalesceCopies` keep their use/def folds and per-instruction walks,
  and call `liveness(..., 'all-blocks')`; the hand-written sweeps are deleted. `Intervals.liveOut`
  narrows from `Set[]` to `ReadonlySet[]` (nothing outside the module reads it).
- `physicalOccupancy` in regalloc is a *third* copy of the same equations, but packed into bitsets
  over physical registers with call-clobber semantics; out of scope here, noted in the report.
- Tests: `tests/stdlib/liveness.test.mjs` (exact sets on a loop CFG; the trap case under both
  scopes; upward exposure; a non-zero entry; the machine scope through `intervals()` on hand-built
  machine code) and `tests/stdlib/layering.test.mjs` (no stdlib import resolves outside
  `src/stdlib/`, which covers framework, typed and tensor).

## Step 3: acceptance

- `tests/typed/backend.test.mjs`: 14 pass. The baselines check prints `no differences` (byte-identical
  images), see the report for the suite counts.
