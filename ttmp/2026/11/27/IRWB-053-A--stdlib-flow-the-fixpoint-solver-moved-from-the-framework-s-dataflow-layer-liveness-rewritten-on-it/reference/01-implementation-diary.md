---
Title: Implementation diary
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
      Note: the moved solver (solve, FlowGraph/SolveOptions/Solution, depthFirst, DataflowError)
    - Path: repo://src/framework/dataflow/solver.ts
      Note: now a re-export shim, so the dataflow layer's callers are unchanged
    - Path: repo://src/stdlib/flow/liveness.ts
      Note: rewritten on solve over the set lattice; fake entry-edges carry the all-blocks scope
    - Path: repo://tests/stdlib/solve.test.mjs
      Note: the solver's fixpoints by hand, the widening loop, the unreachable block, liveness vs old
    - Path: repo://src/stdlib/flow/liveness.ts
      Note: rewritten on solve; the fake entry-edges of the all-blocks scope
    - Path: repo://ttmp/2026/11/27/IRWB-053-A--stdlib-flow-the-fixpoint-solver-moved-from-the-framework-s-dataflow-layer-liveness-rewritten-on-it/scripts/03-liveness-ab.mjs
      Note: the interleaved old-vs-new liveness A/B (the decisive timing)
ExternalSources: []
Summary: "The solver move, the liveness rewrite (the all-blocks scope as fake entry-edges), the timing story and the acceptance runs"
LastUpdated: 2026-11-27T22:55:00-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary: stdlib/flow, the fixpoint solver

## Step 1 — reading the ground

Read `src/stdlib/index.ts` (admission rule R3, layering D), the framework solver
(`src/framework/dataflow/solver.ts`: `solve`, `FlowGraph`, `SolveOptions`, `Solution`,
`DataflowError`, and the `depthFirst` helper it already takes from `stdlib/graph`),
`src/framework/dataflow/analysis.ts` (the first client, through `dataflow()`),
`src/framework/dataflow/lattices.ts` (the precedent: IRWB-048-B moved a module by making the
framework file a re-export shim), and `src/stdlib/flow/liveness.ts` (the second client, which
hardcodes its own backward sweep). The scope tests of `tests/stdlib/liveness.test.mjs` pin the
one behavioural trap: a block no path from the entry reaches, where 'all-blocks' and
'entry-reachable' must disagree.

`src/typed/analyses.ts` imports only the `FlowGraph` *type* from `framework/dataflow/solver.js`,
so — as for the lattices in 048-B — the shim keeps it working without an edit; the brief's scope
line about "the import in typed/analyses.ts" needed no change.

## Step 2 — the move

`src/stdlib/flow/solve.ts`: the module copied from the framework file with only its imports
rewritten — `depthFirst` now comes from `../graph/orders.js` (inside the library, not through the
index, which would import the index from a module the index re-exports) and `Lattice` from
`../lattice/lattices.js`. Not one line of the algorithm changed. `src/framework/dataflow/solver.ts`
becomes the re-export shim (`export * from '../../stdlib/flow/solve.js'`), exactly as
`dataflow/lattices.ts` did in 048-B, so `analysis.ts`, `typed/analyses.ts` and every test that
imports `framework/dataflow` keep working. `src/stdlib/index.ts` gains `solve`, `DataflowError` and
the three types, and its flow line now names both primitives; the solver's `depthFirst` is
deliberately **not** re-exported from the index because the graph module's `depthFirst` (over a
`Digraph`) already owns that name — it stays reachable through the module and through the
framework's re-export (noted in a comment in the index).

## Step 3 — liveness on the solver, and the scope problem

The rewrite is one `solve` call: backward, over `setLattice<number>()`, `transfer` = the gen/kill
equation, block indices spelled as strings. 'entry-reachable' is then free: the solver already
leaves unreachable blocks at bottom.

'all-blocks' is the real design problem. The solver walks from the entry, so unreachable blocks
would never be visited — but machine liveness must compute their live-out from their real
successors. The solution is in the module comment: the flow graph handed to `solve` carries one
**fake edge entry -> u per unreachable u**, and the `edge` function maps exactly those edges to
bottom. A fake edge makes u visited (its equations still run over its real successors) but
contributes nothing to the entry's live-out; a real edge from the entry can never reach an
unreachable block, so "from the entry, to an unreachable block" identifies the fake edges exactly.
No new retreating edges arise from fake edges (each u is entered once, from the entry, never
while active), and widening is not in play (the set lattice is finite), so the loop-head bookkeeping
is unaffected. One `solve` call reproduces both scopes.

## Step 4 — what the timing actually said

The brief asks for the corpus compile time under `speed`, before and after, with a 10% decision
rule. Probes:

- `01-compile-time.mjs` (full speed pipeline over the 5 biggest corpus projects, median of 5):
  before 9610/9840 ms; after 9228 ms — but also 15651 and 13352 ms in runs that coincided with
  load spikes (the machine is shared; `uptime` showed load average 22). End-to-end timing is
  noise-dominated here; the clean "after" reading is *faster* than both "before" readings.
- `02-liveness-time.mjs` (`intervals()` over the same projects' machine code, separate processes):
  before 3.64 ms, after 19.45 ms — then 5.19 and 3.97 ms on re-runs of the **same** dist. Cross-
  process microbenchmarks on this machine are not evidence either.
- `03-liveness-ab.mjs` is the measurement I trust: both implementations in **one process**,
  interleaved 200 rounds over the real machine CFGs of the 5 projects (the workload regalloc and
  coalesce see), after checking the two agree on every graph. Result: **old 4.68 ms, new 4.28 ms
  (median), ratio 0.91; mins 3.33 vs 3.34 ms, ratio 1.00.** Equal within noise — the earlier 5x
  was the per-edge `edge` closure (machine code has no unreachable blocks) plus JIT and load noise.

One real optimisation came out of this: the `edge` function is now passed only when the graph
actually has unreachable blocks (the common machine case pays nothing).

Decision: liveness is not more than 10% slower on the corpus — it is equal within noise on the
interleaved A/B, and the liveness step is ~0.05% of a 9+ s corpus compile. One implementation kept;
no second copy.

## Step 5 — the tests

`tests/stdlib/solve.test.mjs`, 8 tests: forward and backward fixpoints computed by hand on small
graphs (a diamond, a loop), the widening loop (the interval lattice's own `widen`, `loopHeads`,
the `noWidening` refusal, `widenAfter` with up-to thresholds), the unreachable block (bottom facts,
no pollution of the join, the backward boundary at exits, `badGraph`), the two schedules agreeing
on a finite lattice, the one-copy check (the framework re-export is the library's own `solve` and
`DataflowError`), and the equivalence: 300 seeded random graphs (2–10 blocks, random successors,
uses/defs, 20% non-zero entries) × both scopes, against a copy of the old liveness kept in the
test — with the batch asserting it covers the trap cases (236 graphs with unreachable blocks, 199
with cycles, of 300). Two of my own bugs surfaced here first: my cycle detector recursed forever
(a retreating edge must return, not recurse), and I passed `blocks` where the old code passes the
graph (the exact class of mistake the copied reference is there to catch).

## Step 6 — acceptance

- `npm run build`, then the coordinator's baselines: `no differences from .../various/baselines/main.json`
  (RV32 image hashes, instruction counts, edit records for r0/O2/speed; CUDA sources and
  `optimizeTix` revisions).
- `npm run check` clean; `npx prettier --check` clean on every file I touched;
  `node tools/build-site.mjs`: `dist/site built ... 131 source files`.
- suites, gpu files excluded, files passed explicitly:
  - `tests/stdlib/*.test.mjs tests/framework/*.test.mjs tests/workbench/*.test.mjs`: 323 pass, 0 fail,
    1 skipped (`IRWB_FULL=1` gate, pre-existing);
  - `tests/typed/*.test.mjs` (no gpu): 186 pass, 0 fail, 2 skipped (`IRWB_CANDELA=1`, pre-existing);
  - `tests/tensor/*.test.mjs` (no gpu): 45 pass, 0 fail.
- No existing assertion changed anywhere: the rewrite is behind the same interface with the same
  results, and the baselines say so.

## What did not go well, and what I would do differently

- I first believed the cross-process microbench (5x slower) and spent a round on the round-robin
  schedule (no better: 5.32 vs 5.19 ms) before realising the machine's load made every separate-
  process number meaningless. Interleaved A/B in one process should have been the first probe; the
  "after" end-to-end run that agreed with "before" (9228 ms) already hinted the 5x was not real.
- The first version passed the `edge` closure unconditionally in the all-blocks scope; the A/B made
  the cost visible and the fix (only when unreachable blocks exist) is one line. Measuring before
  structuring the fast path would have saved the detour.
