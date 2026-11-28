---
Title: Phase 4 report
Ticket: IRWB-058
Status: active
Topics: []
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/stdlib/flow/solve-for.ts
      Note: Demand-driven lattice equations
    - Path: repo://src/typed/sccp.ts
      Note: First production client
    - Path: repo://tests/stdlib/solve-for.test.mjs
      Note: Known solutions and budget cases
    - Path: repo://tests/typed/ssa.test.mjs
      Note: Late executable edge regression
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T23:47:00.245476996-05:00
WhatFor: ""
WhenToUse: ""
---

# Phase 4 report

`solveFor` stays in `stdlib/flow`, with SCCP as its production client. The PE prototype missed the line-count gate, so the branch restores B1 and withdraws the prototype library and tests from the final tree. Commit `77e1bed` preserves the tested experiment.

## Local equation solving

`solveFor` accepts pure monotone equations over a lattice, root keys with stable Map identity, and an evaluation budget. A read through `get` discovers an unknown at bottom and subscribes the current equation to its changes. Reevaluation refreshes those subscriptions. Updates ascend by join, with the lattice's widening at keys selected by `widenAt`. For finite discovery and terminating ascending chains, the worklist reaches a stable solution. Exhaustion returns partial facts.

A fixed-graph solver could encode every candidate edge and SSA name upfront. Local solving lets the executable edges demand successors and lets the reachable definitions demand their operands. SCCP keeps its Typed-specific transfer functions and declares the existing framework SSA analysis as a pass dependency. The rewrite still uses the Typed transaction and the original correspondence reasons. Its public `rounds` diagnostic now counts solver batches.

The solver fixtures cover gated discovery, cyclic dependencies, budget exhaustion and interval widening. A Typed regression exercises the edge that becomes executable when a backedge changes a branch condition from constant to varying.

## B1 decision

| Version | `specialize.ts` | `pe.ts` | Total |
| --- | ---: | ---: | ---: |
| Starting checkout | 279 | 369 | 648 |
| Restatement | 279 | 373 | 652 |
| Retained checkout | 279 | 369 | 648 |

The gate is 324 lines, half of the actual starting checkout. The synthesis quotes 719 lines for an earlier cell. The result exceeds either limit.

The trial extracted congruence propagation and memoized scheduling by program point and projected static environment. Typed supplied the static kinds, buffer and frame evaluator, residual control flow and transaction edits. The original local loops were simpler for this single client because adapting those callbacks consumed the savings from shared scheduling. The experiment passed the division fixture, all three budget-outcome fixtures and all seven B1 tests. Those four library fixtures live with the prototype in `77e1bed`; the final tree keeps the solver and SCCP fixtures.

The before, experiment and restored B1 runs all measured 110 instructions for the Fibonacci entry and 122 for entry 34 under `promote+speed`, for `n=12` and `seed=8` with coalescing enabled. The existing residual-pipeline tests each assert 74 instructions for their fixtures. The two numbered scripts reproduce the line count and the `promote+speed` measurements.

## Verification

| Suite | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| Typed | 187 | 0 | 2 |
| Framework | 259 | 0 | 0 |
| Workbench | 24 | 0 | 1 |
| Stdlib | 50 | 0 | 0 |
| Tensor CPU | 45 | 0 | 0 |

The three skips are existing opt-in Candela tests. The Tensor GPU files were excluded from the invocation. `npm run build`, `npm run check` and `node tools/build-site.mjs` passed. Prettier passed on changed TypeScript and new scripts and tests. The repository-wide Prettier check reported eight untouched files in Framework and Typed. No existing assertion changed.

The requested coordinator check exited successfully and printed `no differences from …/various/baselines/main.json`. Its informational inline timing was 0.562 → 1.562 ms per application. The coordinator files were left intact.
