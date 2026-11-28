---
Title: 'stdlib/flow: the fixpoint solver moved from the framework''s dataflow layer, liveness rewritten on it'
Ticket: IRWB-053-A
Status: active
Topics:
    - compiler
    - ir
    - typescript
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://scripts/03-liveness-ab.mjs
      Note: the interleaved old-vs-new liveness A/B that decided the 10% question
    - Path: repo://src/framework/dataflow/solver.ts
      Note: |-
        re-export shim, so the dataflow layer's callers keep their imports
        The re-export shim that keeps the dataflow layer's callers unchanged
    - Path: repo://src/stdlib/flow/liveness.ts
      Note: |-
        second client, on solve over the set lattice; all-blocks via fake entry-edges
        Second client, on solve over the set lattice; the all-blocks scope as fake entry-edges
    - Path: repo://src/stdlib/flow/solve.ts
      Note: |-
        the moved solver (solve, FlowGraph/SolveOptions/Solution, depthFirst, DataflowError)
        The moved solver: solve, its three types, depthFirst from stdlib/graph, DataflowError
    - Path: repo://tests/stdlib/solve.test.mjs
      Note: |-
        the solver's tests and the liveness equivalence on 300 generated graphs
        The solver's tests and the liveness equivalence against the old implementation
    - Path: repo://ttmp/2026/11/27/IRWB-053-A--stdlib-flow-the-fixpoint-solver-moved-from-the-framework-s-dataflow-layer-liveness-rewritten-on-it/scripts/03-liveness-ab.mjs
      Note: The interleaved old-vs-new liveness A/B that decided the 10% question
ExternalSources: []
Summary: The framework's fixpoint solver moved to stdlib/flow/solve (re-exported by the dataflow layer), liveness rewritten on it with the same results and equal corpus speed
LastUpdated: 2026-11-27T23:05:00-05:00
WhatFor: ""
WhenToUse: ""
---

# stdlib/flow: the fixpoint solver moved from the framework's dataflow layer, liveness rewritten on it

## Overview

IRWB-039 phase 2c, the solver extraction: the framework's fixpoint solver
(`src/framework/dataflow/solver.ts`, IRWB-001 E4) moved into the standard library as
`src/stdlib/flow/solve.ts` — `solve` with its `FlowGraph`, `SolveOptions` and `Solution` types,
the `depthFirst` order, and `DataflowError` — not rewritten, only its two imports retargeted inside
the library. The framework's dataflow layer re-exports it, so `analysis.ts`, `typed/analyses.ts`
and every dataflow caller keep working unchanged. The second client is the library's own liveness,
whose hardcoded backward sweep is deleted: it is now one backward `solve` over `setLattice`, with
the 'all-blocks' scope carried by fake entry-edges mapped to bottom.

The 10% question is answered with an interleaved A/B in one process (200 rounds over the real
machine CFGs of the 5 biggest corpus projects): old 4.68 ms, new 4.28 ms median, mins 3.33 vs
3.34 ms — equal within noise, so one implementation is kept. The baselines say `no differences`.

Done. Acceptance: `tests/stdlib/solve.test.mjs` (8 tests) and all suites pass (323 + 186 + 45 pass,
0 fail, 3 pre-existing skips), the coordinator's baselines print `no differences`, `npm run check`
is clean, the site builds. Read
[the report](./reference/02-report-the-fixpoint-solver-in-the-standard-library.md) and
[the diary](./reference/01-implementation-diary.md).

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **done** (2026-11-27)

## Topics

- compiler
- ir
- typescript

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.

## Structure

- design/ - Architecture and design documents
- reference/ - Prompt packs, API contracts, context summaries
- scripts/ - Temporary code and tooling
- various/ - Working notes and research
- archive/ - Deprecated or reference-only artifacts
