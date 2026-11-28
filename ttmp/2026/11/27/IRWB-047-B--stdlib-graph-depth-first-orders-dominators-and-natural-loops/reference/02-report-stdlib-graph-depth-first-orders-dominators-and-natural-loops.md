---
Title: 'Report: stdlib/graph — depth-first orders, dominators and natural loops'
Ticket: IRWB-047-B
Status: complete
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: 'What IRWB-047-B built: src/stdlib/graph over one digraph, Typed’s analyses and the framework solver on it, byte-identical baselines.'
LastUpdated: 2026-11-27
WhatFor: 'The report of IRWB-047-B (IRWB-039 phase 2c, graph part).'
WhenToUse: 'Reviewing the graph extraction, or before changing src/stdlib/graph and its two clients.'
---

# Report: stdlib/graph — depth-first orders, dominators and natural loops

Ticket: `ttmp/2026/11/27/IRWB-047-B--stdlib-graph-depth-first-orders-dominators-and-natural-loops/`.
Design: `design/01-stdlib-graph-one-digraph-interface-and-the-four-primitives.md`.
Diary: `reference/01-implementation-diary.md`. Probe: `scripts/01-graph-primitives.mjs`.

## What changed, file by file

- `src/stdlib/graph/digraph.ts` (new) — `Digraph<N>` (nodes, entry, successors), `Edge<N>`, and
  `predecessors(graph)` derived from `succ`; the one shape every primitive in the directory takes.
- `src/stdlib/graph/orders.ts` (new) — `depthFirst(graph)` → `{ postorder, rpo, retreating }`: the
  framework solver's stack walk, moved, now recording the edges it retreats along.
- `src/stdlib/graph/dominators.ts` (new) — `dominators(graph)` (Cooper, Harvey and Kennedy, with the
  round count), `dominates(idom, a, b)`, `dominatorTree(idom)`.
- `src/stdlib/graph/loops.ts` (new) — `naturalLoops(graph)`: one loop per header with all its latches
  (IRWB-034-G grouping kept), body, exits, preheader.
- `src/stdlib/index.ts` — exports the primitives; `graph/` moves from "later" to "what exists", with
  dominance frontiers left as the later line.
- `src/typed/analyses.ts` — private `digraphOf(f)` builds the digraph and the cfg records in one
  pass; `cfgOf` takes `rpo` from `depthFirst`, `dominatorsOf`/`domView`/`loopsOf` are now thin
  adapters over the library (same public shapes, and the recursive `dfs`, the CHK iteration, the
  `dominates` climb, the children inversion and the whole loop construction are deleted).
- `src/framework/dataflow/solver.ts` — only `depthFirst`: same signature, body is the library's walk
  with `retreating.map(e => e.to)` as the loop-head set.
- `tests/stdlib/graph.test.mjs` (new) — 8 tests: the loop with a preheader, the same loop with two
  outside predecessors, an unreachable block with an unreachable self-loop, two back edges to one
  header, an irreducible two-entry cycle, the framework client, and Typed's analyses against the
  library on `blend` and `regex-nfa`.
- `tests/stdlib/layering.test.mjs` — one added test that the index exports the graph primitives.
- `tests/framework/layering.test.mjs` — **an existing assertion changed**: the framework's import
  rule was "nothing outside `src/framework`", now "nothing outside `src/framework` except
  `src/stdlib`". Reason: the brief makes the dataflow solver a client of the depth-first order, and
  phase 2c says the framework solver's helpers move to the library rather than being duplicated. The
  library imports nothing outside itself and `tests/stdlib/layering.test.mjs` forbids the reverse
  direction, so no cycle is possible; domains remain forbidden for the framework.

## Acceptance (on `efd1a73`)

- **My tests**: `node --test tests/stdlib/*.test.mjs` → 16 tests, 16 pass (graph 8, liveness 5,
  layering 3), 0 fail. What each primitive returns where the brief asks for it, stated in the tests:
  - unreachable block: absent from `postorder`/`rpo`/`retreating`, absent from `idom` (so the only
    node dominating it is itself), no key in the dominator tree; and a self-loop on an unreachable
    block *is* a natural loop of that unreachable header (body `[u]`, exit `t`), because dominance is
    reflexive and the moved code never filtered on reachability.
  - loop with two back edges to one header: one loop, `latches ['l1','l2']`, body `[h,l2,a,l1]` (the
    union, the IRWB-034-G fix), exits `[x]`, preheader `e`.
  - irreducible two-entry cycle: `retreating` `[{b→a}]` but `naturalLoops` `[]` — a natural loop is a
    reducible notion, so the solver still widens at `a` while a loop pass sees nothing.
- **Baselines**: after `npm run build`, `node ttmp/…/IRWB-039…/scripts/02-baselines.mjs check` prints
  `no differences` (all RV32 image hashes, instruction counts, edit records for r0/O2/speed and all
  Tix CUDA sources and `optimizeTix` revisions). A `check` on the untouched checkout printed the same
  before the change.
- **Suites**: `tests/framework` 243 tests, 243 pass; `tests/typed` 188 tests, 186 pass, 2 skipped
  (Candela/env-gated), 0 fail; `tests/workbench` 25 tests, 24 pass, 1 skipped, 0 fail;
  `tests/tensor` minus `*-gpu` 45 tests, 45 pass, 0 fail; `tests/stdlib` 16 pass. No test was
  weakened; no `todo` test covered this step.
- `npm run check` (tsc) clean. Prettier clean on every file this step created or touched (`npm run
  format:check` still warns on the same nine files that were unformatted before). `node
  tools/build-site.mjs` builds (3109 KiB bundle, 50 projects, 17 chapters, 131 source files).

## Decisions worth reviewing

- **Generic digraph, not numbered nodes.** Typed and the framework name blocks with strings; a
  numeric interface would need an index map in both clients plus a translation of every result — the
  "adapter larger than the algorithm" case the design doc says should keep the domain copy. Cost:
  one type parameter. Alternative tried and rejected on that ground only.
- **Predecessors derived, not passed.** Only `naturalLoops` needs them, and `succ` determines them, so
  the interface stays three fields and one source of truth. The alternative (`preds` in `Digraph`)
  duplicates a relation the callers already maintain, and Typed's `cfgOf` shows how the two records
  can disagree on undeclared targets.
- **`naturalLoops` computes its own dominators.** No second entry point taking a precomputed
  `Dominators`: the only caller that has them (Typed's dominators analysis) is a different analysis,
  cached separately, and a default parameter would be a second path. Cost: the dominator iteration
  runs once per loops analysis, exactly as the code it replaces did (`loopsOf` called
  `dominatorsOf`).
- **`assigned` and the loop `id` stay in Typed's adapter**, since both need the statement IR and a
  naming convention. Every adapter is a field mapping, not an algorithm.
- **One latent hazard removed in the move**: the old CHK loop could have stored a `null` immediate
  dominator and then climbed it in `meet` (a non-terminating loop); the moved version only meets
  predecessors that have an immediate dominator, which the reverse postorder guarantees. The
  observable results and the round counts are unchanged (checked on every function of `blend` and
  `regex-nfa`, and by the baselines).

## Left out, and one thing found

- **A third copy of the depth-first order exists** at `src/typed/backend/frequency.ts:130-152`
  (reverse postorder from the entry, iterative DFS, plus Tarjan SCC above it), and `layout.ts` talks
  about back edges. That file is outside this step's scope, so it still has its own copy; it is the
  obvious next client of `depthFirst`, and `src/typed/ssa.ts`'s dominance-frontier construction is
  the obvious next primitive (`graph/ dominance frontiers`, still one line in `index.ts`).
- **No `src/tensor/` client**: this step's primitives are CFG algorithms and Tix has no CFG. Both
  admitted clients are inside the Typed/framework path, as the brief lists them.
- `tools/build-site.mjs`'s source browser walks `src/workbench`, `src/typed` and `src/framework`
  only, so the framework file now shown there imports `src/stdlib/graph/orders.ts`, which the browser
  will not display. `src/tensor` is unlisted by the same convention, so I did not widen it; the site
  builds and the site test passes.
- Nothing in the brief or the existing tests looked wrong. The one existing assertion I changed is
  the framework layering rule above; it is the direct consequence of the brief's client list, not a
  behaviour my step changed in the framework.
