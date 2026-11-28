---
Title: "Report: the fixpoint solver in the standard library"
Ticket: IRWB-053-A
Status: active
Topics:
    - compiler
    - ir
    - typescript
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/stdlib/flow/solve.ts
      Note: the solver, moved from framework/dataflow (solve, types, depthFirst, DataflowError)
    - Path: repo://src/framework/dataflow/solver.ts
      Note: re-export shim; the dataflow layer's callers keep their imports
    - Path: repo://src/stdlib/flow/liveness.ts
      Note: the second client, on solve over the set lattice; all-blocks via fake entry-edges
    - Path: repo://tests/stdlib/solve.test.mjs
      Note: the solver's tests and the liveness equivalence on 300 generated graphs
    - Path: repo://ttmp/2026/11/27/IRWB-053-A--stdlib-flow-the-fixpoint-solver-moved-from-the-framework-s-dataflow-layer-liveness-rewritten-on-it/scripts/03-liveness-ab.mjs
      Note: the interleaved liveness A/B that decided the 10% question
ExternalSources: []
Summary: "The solver moved not rewritten, liveness on it with the same results, the timing answer (equal within noise), and the acceptance evidence"
LastUpdated: 2026-11-27T23:00:00-05:00
WhatFor: ""
WhenToUse: ""
---

# Report: the fixpoint solver in the standard library (IRWB-053-A)

## What was done

IRWB-039 phase 2c, the solver extraction. The framework's fixpoint solver
(`src/framework/dataflow/solver.ts`, IRWB-001 E4) moved into the standard library as
`src/stdlib/flow/solve.ts` — `solve` with its `FlowGraph`, `SolveOptions` and `Solution` types, the
`depthFirst` order it takes from `stdlib/graph`, and `DataflowError` — **not rewritten**: only the
two imports changed (`../graph/orders.js`, `../lattice/lattices.js`). The framework's
`dataflow/solver.ts` is now a re-export shim, exactly as `dataflow/lattices.ts` became one in
IRWB-048-B, so `framework/dataflow/analysis.ts` (and through it Typed's dataflow analyses) and the
`FlowGraph` type import in `typed/analyses.ts` kept working with **no edit** — the brief's scope
line about that import turned out to need no change.

The second client is the library's own liveness (`src/stdlib/flow/liveness.ts`), whose hardcoded
backward sweep is deleted. It is now one `solve` call: backward, over `setLattice<number>()`, the
gen/kill equation as `transfer`. The 'entry-reachable' scope is the solver's native behaviour
(unreachable blocks keep bottom). The 'all-blocks' scope — machine liveness, which must compute the
live-out of a block no path reaches — is carried by **fake edges**: the flow graph handed to
`solve` gets one edge entry -> u per unreachable block u, and the `edge` function maps exactly
those edges to bottom, so u is visited and its equations run over its real successors, while
nothing flows into the entry's live-out. A real edge from the entry can never reach an unreachable
block, so the fake edges are identified exactly. The `edge` closure is passed only when the graph
actually has unreachable blocks, so the common machine case pays nothing for the scope.

**Results are the same**: the baselines say `no differences`, and a copied reference to the old
implementation agrees with the new one on 300 seeded random graphs × both scopes (236 of them with
unreachable blocks, 199 with cycles), and on every real corpus machine CFG in the A/B probe.

## The timing question, answered with numbers

The brief: measure the corpus compile time under `speed` before and after; if liveness is more
than about 10% slower on the corpus, keep both implementations.

- End-to-end (`scripts/01-compile-time.mjs`, full speed pipeline, the 5 biggest corpus projects,
  median of 5): **before 9610.1 and 9840.2 ms; after 9227.8 ms** in the clean run. Two further
  "after" runs (15650.9, 13352.4 ms) coincided with load spikes — this machine is shared and
  `uptime` showed load average 22; they are in `scripts/01-compile-time.after.txt` with that
  context.
- The first cross-process microbench (`scripts/02-liveness-time.mjs`: `intervals()` over the same
  projects' machine code) said 3.64 ms before vs 19.45 ms after — but re-runs of the same dist gave
  5.19 and 3.97 ms, so that comparison was load and JIT noise, plus one real cost it did surface:
  the per-edge `edge` closure (now passed only when unreachable blocks exist).
- The measurement that decides it (`scripts/03-liveness-ab.mjs`): both implementations interleaved
  in **one process**, 200 rounds over the real machine CFGs of the 5 projects under `speed`
  (scope 'all-blocks', the regalloc/coalesce workload), after checking the two agree on every
  graph:

  ```
  15 fns, 200 rounds: TOTAL old 4.68ms (min 3.33)  new 4.28ms (min 3.34)
  ratio median 0.91   min 1.00
  ```

**Liveness is not more than 10% slower on the corpus — it is equal within noise** (if anything,
slightly faster on the median). One implementation is kept; there is no second copy. The liveness
step is ~0.05% of a 9+ s corpus compile, so even the worst cross-process reading (5 ms) would have
been invisible end-to-end.

## Acceptance (on the last commit)

- **My tests** — `tests/stdlib/solve.test.mjs`, 8 tests, all pass: forward and backward fixpoints
  computed by hand; a loop that needs widening (the interval lattice's own `widen`, `loopHeads`,
  the `noWidening` refusal, `widenAfter` with up-to thresholds); an unreachable block (bottom
  facts, no pollution, the backward boundary, `badGraph`); the worklist and round-robin schedules
  agreeing on a finite lattice; the one-copy check (the framework re-exports the library's own
  `solve`/`DataflowError`); and liveness-via-solver == the old liveness on 300 seeded generated
  graphs, both scopes, against a copy of the old function kept in the test.
- **The baselines**: `no differences from .../various/baselines/main.json` — RV32 image hashes,
  instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the
  CUDA source and `optimizeTix` revisions for every Tix program.
- **The suites** (gpu files excluded, files passed explicitly): stdlib + framework + workbench
  **323 pass, 0 fail**, 1 pre-existing skip (`IRWB_FULL=1`); typed **186 pass, 0 fail**, 2
  pre-existing skips (`IRWB_CANDELA=1`); tensor **45 pass, 0 fail**.
- `npm run check` clean; Prettier clean on every file touched; `node tools/build-site.mjs` builds
  (`dist/site built in 446 ms ... 131 source files`).
- No existing test assertion was changed.

## Files, one line each

- `src/stdlib/flow/solve.ts` — new: the solver moved from `framework/dataflow/solver.ts` (imports
  rewritten to `../graph/orders.js` and `../lattice/lattices.js`, algorithm unchanged).
- `src/framework/dataflow/solver.ts` — now a re-export shim (`export * from '../../stdlib/flow/solve.js'`).
- `src/stdlib/flow/liveness.ts` — rewritten on `solve` over the set lattice; the hardcoded sweep
  deleted; 'all-blocks' carried by fake entry-edges mapped to bottom by `edge` (only when
  unreachable blocks exist).
- `src/stdlib/index.ts` — exports `solve`, `DataflowError`, `FlowGraph`, `SolveOptions`, `Solution`;
  the flow line names both primitives; the "later modules" line for the solver removed; a comment on
  why the solver's `depthFirst` is not re-exported (the graph module's owns the name).
- `tests/stdlib/solve.test.mjs` — new: the solver's tests and the old-liveness equivalence.
- `scripts/01-compile-time.mjs`, `02-liveness-time.mjs`, `03-liveness-ab.mjs` (+ `.txt` outputs) —
  the timing probes, with their readings.

## Left out, and one thing to watch

- The solver's `depthFirst` helper is reachable through `stdlib/flow/solve.js` and the framework's
  re-export, but not through the stdlib index (name clash with `graph`'s `depthFirst`); renaming it
  (e.g. `flowDepthFirst`) is a small later step if a second domain wants it from the index.
- The round-robin schedule exists for ports that must reproduce Compiler Workbench's facts; Typed's
  three dataflow analyses already use it (`typed/analyses.ts`) and are untouched here.
- The brief's scope named "the import in `src/typed/analyses.ts`"; no change was needed — the
  re-export keeps it working, as IRWB-048-B's lattices already showed.
