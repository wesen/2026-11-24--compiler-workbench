---
Title: 'stdlib/flow: the fixpoint solver, moved out of the framework''s dataflow layer, with liveness as the second client'
Ticket: IRWB-053-B
Status: active
Topics:
    - compiler
    - ir
    - typescript
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/stdlib/flow/solver.ts
      Note: the moved solver (solve, FlowGraph, SolveOptions, Solution, DataflowError, flowOrder), body unchanged
    - Path: repo://src/framework/dataflow/solver.ts
      Note: re-export shim; depthFirst is the old name of the library's flowOrder
    - Path: repo://src/stdlib/flow/liveness.ts
      Note: second client, rewritten on solve with the set lattice, both scopes with the same facts
    - Path: repo://src/stdlib/index.ts
      Note: exports the solver and records flow/ in what-exists-now
    - Path: repo://tests/stdlib/flow.test.mjs
      Note: forward/backward fixpoints, widening, unreachable block, liveness vs the old sweep on 300 graphs
    - Path: repo://ttmp/2026/11/27/IRWB-053-B--stdlib-flow-the-fixpoint-solver-moved-out-of-the-framework-s-dataflow-layer-with-liveness-as-the-second-client/scripts/02-speed-interleaved.mjs
      Note: the two-build interleaved compile-time probe the numbers come from
ExternalSources: []
Summary: "The framework's fixpoint solver moved to src/stdlib/flow unchanged and is re-exported by the dataflow layer; liveness is rewritten on it with the set lattice, same facts, no measurable corpus regression"
LastUpdated: 2026-11-27T23:35:00-05:00
WhatFor: ""
WhenToUse: ""
---

# stdlib/flow: the fixpoint solver, with liveness as the second client

## Overview

IRWB-039 phase 2d: the framework's monotone fixpoint solver (`solve`, `FlowGraph`, `SolveOptions`,
`Solution`, `DataflowError`, the entry walk) moved into the standard library as
`src/stdlib/flow/solver.ts`, unchanged in its algorithm, and `src/framework/dataflow/solver.ts` re-exports
it — so `dataflow()` and Typed's liveness, reaching-definitions and ranges analyses keep their imports and
their facts. The second client is the library's own liveness, which had hardcoded its backward fixpoint:
it is now the solver with the set lattice, under both of its scopes (`all-blocks`, which needs a phantom
entry block to say "every block" to a solver that walks from one entry, and `entry-reachable`, which is the
solver's own behaviour), with the same facts and the old sweep deleted.

Done. Acceptance: `tests/stdlib/flow.test.mjs` (8 tests) and the five suites pass (554 pass, 0 fail, 3
pre-existing skips), the coordinator's baselines print `no differences`, `npm run check` is clean and the
site builds. Liveness itself is 16–28% slower per call on real machine code (about 2 ms of a 32 s corpus
build, 0.006%); corpus compile time under `speed` does not move beyond noise. Read
[the report](./reference/02-report-stdlib-flow-the-fixpoint-solver.md) and
[the diary](./reference/01-implementation-diary.md).

## Key Links

- **Related Files**: see the frontmatter of this index and of the report
- **Report**: `reference/02-report-stdlib-flow-the-fixpoint-solver.md`
- **Diary**: `reference/01-implementation-diary.md`
- **Probes**: `scripts/01-speed-timing.mjs`, `scripts/02-speed-interleaved.mjs`,
  `scripts/03-liveness-timing.mjs`, and their output files

## Status

Current status: **done** (2026-11-27); follow-ups in [tasks.md](./tasks.md)

## Topics

- compiler
- ir
- typescript
