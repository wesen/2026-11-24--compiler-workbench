Done. Last commit `66d5b8b` (code in `efd1a73`; the last commit adds only the ticket docs).

## Ticket and report

- Ticket: `ttmp/2026/11/27/IRWB-047-B--stdlib-graph-depth-first-orders-dominators-and-natural-loops/`
- Report: `…/reference/02-report-stdlib-graph-depth-first-orders-dominators-and-natural-loops.md`
- Design: `…/design/01-stdlib-graph-one-digraph-interface-and-the-four-primitives.md`; diary: `…/reference/01-implementation-diary.md`; probe: `…/scripts/01-graph-primitives.mjs`

## What changed

- `src/stdlib/graph/digraph.ts` (new) — `Digraph<N>` (nodes, entry, successors), `Edge<N>`, `predecessors(graph)` derived from `succ`.
- `src/stdlib/graph/orders.ts` (new) — `depthFirst` → `{ postorder, rpo, retreating }`: the solver's stack walk moved, now recording retreating edges.
- `src/stdlib/graph/dominators.ts` (new) — `dominators` (Cooper–Harvey–Kennedy, with round count), `dominates`, `dominatorTree`.
- `src/stdlib/graph/loops.ts` (new) — `naturalLoops`: one loop per header with all its latches (IRWB-034-G kept), body, exits, preheader.
- `src/stdlib/index.ts` — exports the primitives; `graph/` moved from "later" to "what exists".
- `src/typed/analyses.ts` — one private `digraphOf(f)`; `cfgOf`, `dominatorsOf`, `domView`, `loopsOf` are thin adapters over the library; the recursive `dfs`, the CHK iteration, the `dominates` climb, the children inversion and the whole loop construction are deleted.
- `src/framework/dataflow/solver.ts` — only `depthFirst`: same signature, body is the library's walk, heads = retreating targets.
- `tests/stdlib/graph.test.mjs` (new, 8 tests); `tests/stdlib/layering.test.mjs` (+1 index-export test).
- `tests/framework/layering.test.mjs` — **one existing assertion changed**: the framework may now import `src/stdlib` (never a domain), because the brief makes the solver a client; the library imports nothing outside itself (`tests/stdlib/layering.test.mjs` forbids the reverse), so no cycle.

## Acceptance

- My tests: `tests/stdlib/*.test.mjs` 16 tests, 16 pass. Includes the unreachable block (absent from orders/`idom`; an unreachable self-loop *is* a natural loop of the unreachable header), two back edges to one header (one loop, two latches, union body), and an irreducible two-entry cycle (retreating edge `b→a`, **no** natural loop).
- Baselines (`02-baselines.mjs check` after `npm run build`, re-run on the last commit): `no differences`.
- Suites: framework 243/243 · typed 188 tests / 186 pass / 2 skipped / 0 fail · workbench 25 / 24 pass / 1 skipped / 0 fail · tensor without `*-gpu` 45/45 · stdlib 16/16.
- `npm run check` clean; Prettier clean on every file touched (the 9 warned files were unformatted before); `node tools/build-site.mjs` builds (3109 KiB, 50 projects, 17 chapters, 131 source files).

## Left out / notes

- `src/typed/backend/frequency.ts:130-152` is a **third** copy of the reverse-postorder DFS (plus Tarjan); outside this step's scope, left as the obvious next client of `depthFirst`. Dominance frontiers (`ssa.ts`) stay a one-line "later" entry in the index.
- `tools/build-site.mjs`'s source browser still walks only workbench/typed/framework, so a browsed framework file imports a stdlib file the browser won't show (`src/tensor` is unlisted by the same convention); the site builds and its test passes.
- The one thing I believe needed changing in the repository, not the brief: the framework layering rule, as described above. Nothing else in the brief looked wrong.
