---
Title: Implementation diary
Ticket: IRWB-053-B
Status: active
Topics:
    - compiler
    - ir
    - typescript
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: src/stdlib/flow/solver.ts
      Note: the solver, moved from src/framework/dataflow/solver.ts
    - Path: src/framework/dataflow/solver.ts
      Note: now a re-export shim, with depthFirst kept as the old name of flowOrder
    - Path: src/stdlib/flow/liveness.ts
      Note: rewritten on the solver, the second client
    - Path: tests/stdlib/flow.test.mjs
      Note: the solver's fixpoints, widening, unreachable block, and liveness against the old sweep
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T23:40:00-05:00
WhatFor: ""
WhenToUse: ""
---


# Implementation diary: `stdlib/flow`, the fixpoint solver

## Step 1 — the ground

Read `src/stdlib/index.ts` (admission rule R3: a named algorithm, two clients, an executable test; the
layering D; the `flow/` line said "the fixpoint solver over a lattice (liveness hardcodes its own; this
generalises it)"), `src/framework/dataflow/solver.ts` (165 lines: `FlowGraph`, `SolveOptions`,
`Solution`, `DataflowError`, the entry walk `depthFirst`, `solve`), `src/stdlib/flow/liveness.ts` (the
hand-written backward sweep, with the `LivenessScope` of IRWB-046-B) and the framework test that uses
the solver (`tests/framework/ext-e4.test.mjs`: `solve`, `DataflowError`, the `noWidening` refusal, the
widening at a loop head).

Four facts decided the shape of the move:

1. The solver already imports its entry walk from the library (`stdlib/graph`'s `depthFirst`), so the
   move removes the last thing the dataflow layer owned. The lattices moved in IRWB-048-B; the type
   `Lattice<V>` the solver takes is already the library's.
2. `DataflowError` is thrown by `solve` and asserted in a framework test (`e instanceof DataflowError`,
   imported from `dist/framework/dataflow/index.js`). It has to move with the solver, and the framework's
   `export *` makes the class identity the same object, so that test keeps passing unchanged.
3. The solver exports its entry walk as `depthFirst`, and the library already exports `depthFirst`
   (the graph primitive) from `src/stdlib/index.ts`. Two exports of one name from one module is a
   collision. The library's solver module names it `flowOrder`; the framework shim re-exports it as
   `depthFirst`, which is the name the existing `tests/stdlib/graph.test.mjs` uses
   (`import { depthFirst as solverDepthFirst } from '../../dist/framework/dataflow/solver.js'`).
4. `tests/framework/layering.test.mjs` allows `src/framework/**` to import `src/stdlib/`, so a framework
   re-export is legal (IRWB-048-B's amendment). Only its header comment needed a line for this step.

## Step 2 — the move

`git mv src/framework/dataflow/solver.ts src/stdlib/flow/solver.ts`, then: the header rewritten (what the
solver is, that the lattice and the order are the library's, that liveness is the second client, why
`flowOrder` is exported), the import of the order repointed at `../graph/orders.js`, the lattice type at
`../lattice/lattices.js` (both library-local; the old `./lattices.js` was a shim over the same file), and
`depthFirst` renamed to `flowOrder` in three places. The body of `solve` is not touched: not a line of
the algorithm changed, which is what "moved, not rewritten" has to mean if the baselines are to hold.

`src/framework/dataflow/solver.ts` is now ten lines: `export *` from the library, a header saying where
the solver went, and `export { flowOrder as depthFirst }`. `src/stdlib/index.ts` exports `solve`,
`DataflowError` and the three types, and its "what exists now" line for `flow/` now names both the solver
and liveness; the `flow/` entry under "later modules" is gone. `src/typed/analyses.ts` takes the
`FlowGraph` type from `../stdlib/index.js` (it already imports `depthFirst`, `dominators` … from there),
which is the only edit the domain needed.

`npm run build` and `npm run check` were clean first try this time; the only surprise was the
`depthFirst` name collision, which I resolved before writing anything.

## Step 3 — liveness on the solver, and the shape the solver does not state

The equations are the same: `in(b) = uses(b) ∪ (out(b) \ defs(b))`, `out(b) = ∪ in(s) over succ(b)`,
which is the solver's backward direction with `setLattice()` and the `in` formula as the transfer. The
old sweep is gone.

The whole difficulty is the scope. `entry-reachable` is exactly what the solver does (it walks from the
entry and reports unreachable blocks at bottom). `all-blocks` — the scope the register allocator and the
coalescer use, because an unreachable block is still laid out and its registers still need allocating —
is what the solver does *not* offer: it has no "every block is in play" mode. Options I considered:

- **Add an `allBlocks` option to the solver.** Rejected: the solver is moved, and a new option with a new
  meaning is a different algorithm; the framework's facts are recorded in the baselines.
- **A second copy of the sweep for `all-blocks`.** Rejected: the admission rule says the old copy is
  deleted, and a second implementation of the same job is exactly what the brief forbids.
- **One phantom block at the end** whose successors are every block, under `all-blocks` only. The walk
  from it reaches every block, so the solver's reachability filter never drops one; the phantom is not a
  block of `blocks`, its transfer is the identity, and its facts are dropped. This is what I did. It is
  the smallest statement of "run the equations over every block" in the solver's own terms (a graph and
  an entry), and it changes no result: the equations are the same, and the least fixpoint of a monotone
  system is unique.

The cost is one extra block and one extra join per visit of it; it is measured in probe 03 and it is not
what makes the difference.

The old sweep compared set *sizes* to decide a change (`inn.size !== IN[k].size`), which is an equality
test only because the sets grow; the solver uses the lattice's `equal`. Same answer, and the generated
comparison in `tests/stdlib/flow.test.mjs` says so on 300 graphs under both scopes.

## Step 4 — the tests

`tests/stdlib/flow.test.mjs`, eight tests:

- forward and backward on a 4-block graph with a back edge, facts hand-computed, plus the same facts from
  the round-robin schedule (`rounds > 0`) as a second check on termination;
- a loop whose interval grows without bound: `noWidening` without `widen`, a fixpoint with it, the loop
  head widened to `[0, I32_MAX]`, and `widenAfter: 3` also reaching the fixpoint;
- an unreachable block, both directions, at bottom and never joined;
- an entry that is not a block (`badGraph`), and the framework's re-export being the same function;
- liveness through the solver against `oldLiveness`, a verbatim copy of the pre-change sweep kept in the
  test, on 300 generated CFGs (n ≤ 7 blocks, 0–2 successors each, 30% of them with an unreachable block)
  under both scopes, with a count assertion that the generator actually produces unreachable blocks;
- the hand-written liveness cases (the trap case, the entry-index case, the empty graph).

The generated comparison and the hand-written cases duplicate `tests/stdlib/liveness.test.mjs` on purpose:
that file asserts the primitive's facts, this one asserts that the primitive still has them after the
rewrite. Neither assertion was weakened.

## Step 5 — the measurement, and the first attempt that did not measure anything

Probe 01 times `pipeline('speed')` per corpus project, minimum of five runs, one build per run: before
39,325.55 ms, after 69,431.02 ms for the same 50 projects. That is not a 77% regression; both numbers are
dominated by `chess-search` (24–45 s of the total) and the machine is shared — the same unchanged build
moved that project by 66% between runs (probe 01's file pair, and the same project re-measured at
24.1 s in probe 02).

So probe 02 loads both builds in one process (`out/dist.old` from the pre-change sources, `dist` from
this change) and alternates them per round for each project, taking the minimum per build: drift and
contention hit both equally, and the probe throws if the two builds ever disagree on an image hash. The
numbers are in the report. Probe 03 does the same for liveness alone, on the machine code the corpus
actually produces (`select()` then `intervals()`, the allocator's client), 50 passes per timed round so
that the measurement is 0.2 s and not 7 ms.

## Step 6 — acceptance

- `npm run build`, then `scripts/02-baselines.mjs check` of IRWB-039: `no differences`.
- `tests/stdlib` 56 pass, `tests/framework` 243, `tests/workbench` 24 pass + 1 skip (`IRWB_FULL=1`),
  `tests/typed` 186 pass + 2 skips (`IRWB_CANDELA=1`), `tests/tensor` (the seven non-`-gpu` files) 45.
- `npm run check` clean, `node tools/build-site.mjs` builds, `prettier --check` clean on every file
  this step touched.

## What I would do differently

The first timing attempt was wasted effort: two runs of one build on a shared machine cannot be compared,
and I knew the machine was shared. A single interleaved probe from the start would have produced the
answer (and the two dead runs of 8 and 11 minutes) in one quarter of the time.
