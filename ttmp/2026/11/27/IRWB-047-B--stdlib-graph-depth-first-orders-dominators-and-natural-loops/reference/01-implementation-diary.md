---
Title: Implementation diary
Ticket: IRWB-047-B
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
Summary: 'Diary of IRWB-047-B: the ticket, the design, the four graph primitives, the two clients, acceptance.'
LastUpdated: 2026-11-27
WhatFor: 'Resuming or reviewing IRWB-047-B.'
WhenToUse: 'Before changing src/stdlib/graph or the graph clients.'
---

# Implementation diary

## Step 1: orientation, starting baseline, ticket, design

- Read `src/stdlib/index.ts` (admission rule R3, layering D, one module: `flow/liveness.ts`),
  `src/stdlib/flow/liveness.ts`, `tests/stdlib/{liveness,layering}.test.mjs`, IRWB-046-B's design and
  report (the pattern for this step), and the IRWB-039 design doc's phase 2c ("graph, lattice, ssa,
  moved … not rewritten"; decision point: an adapter larger than the algorithm keeps the domain
  copy).
- Read the code to move: `cfgOf` and its recursive `dfs` (`src/typed/analyses.ts`, line 77),
  `dominatorsOf`/`domView` (142-200), `loopsOf` (217, with the IRWB-034-G latch grouping), and the
  framework solver's `depthFirst` (`src/framework/dataflow/solver.ts:64`).
- Ran the starting baseline before touching anything: `npm run build` then
  `node ttmp/…/IRWB-039…/scripts/02-baselines.mjs check` → `no differences` (4m30s), so the checkout
  I started from is the recorded oracle.
- Ticket created with docmgr (`ttmp/2026/11/27/IRWB-047-B--stdlib-graph-depth-first-orders-dominators-and-natural-loops`),
  design `design/01-stdlib-graph-one-digraph-interface-and-the-four-primitives.md`.
- One finding before writing code: **the framework's layering test forbids `src/framework/` importing
  anything outside `src/framework`**, and this step makes the solver call the library. Decided to
  narrow that rule to "the framework and the library, never a domain" (the library imports nothing
  outside itself, and `tests/stdlib/layering.test.mjs` forbids the reverse direction, so there is no
  cycle) rather than leave a second copy of the DFS in the solver — the duplicated copy is exactly
  what phase 2c deletes. The alternative that keeps the test untouched (do not move `depthFirst`)
  fails the brief's own list of clients.

## Step 2: the library

- `src/stdlib/graph/digraph.ts`: `Digraph<N>` (nodes, entry, successors), `Edge<N>`,
  `predecessors(graph)` derived from `succ` in `nodes` order. Generic in the node type: Typed and the
  framework name blocks with strings, and a numbered interface would force both clients to build an
  index map and translate every result back — an adapter as large as the algorithm (2c's decision
  point).
- `src/stdlib/graph/orders.ts`: `depthFirst(graph)` — the framework solver's stack walk, moved, now
  also recording the retreating edges it meets; returns `{ postorder, rpo, retreating }`. Typed's
  recursive `dfs` produced the same postorder, so one traversal serves both clients.
- `src/stdlib/graph/dominators.ts`: `dominators(graph)` (Cooper, Harvey and Kennedy: one sweep of
  the reverse postorder per round, `meet` climbing by RPO index), `dominates(idom, a, b)` (climb the
  immediate dominators), `dominatorTree(idom)` (children lists). Kept the two conventions Typed's
  stored facts depend on: the entry's `idom` is itself and unreachable nodes are absent. One latent
  hazard of the old code is gone: a `null` idom could have been climbed by `meet`; the moved version
  only meets predecessors that already have one (which the reverse postorder guarantees).
- `src/stdlib/graph/loops.ts`: `naturalLoops(graph)` — back edges from dominance, grouped per header
  (IRWB-034-G), body by backward walk from the latches in the same pop order as before, exits, and
  the preheader rule (one outside predecessor with one successor). Documented what it cannot see: an
  irreducible cycle has retreating edges and no natural loop, and dominance is reflexive so an
  unreachable self-loop is a natural loop of an unreachable header (the moved behaviour).
- `src/stdlib/index.ts`: exported the new primitives; `graph/` moves from "later" to "what exists",
  with dominance frontiers left as the later line.

## Step 3: the two clients

- `src/typed/analyses.ts`: one private `digraphOf(f)` builds the digraph and the successor and
  predecessor records in one pass (successors restricted to blocks, as the old DFS effectively did).
  `cfgOf` keeps its shape and takes `rpo` from `depthFirst`; `dominatorsOf` returns the library's
  result with `idom` flattened to a record (finite JSON); `domView` is `dominates`/`dominatorTree` on
  that record's map; `loopsOf` maps the library's loops to Typed's `Loop` (`id`, `head`, `assigned`).
  All public shapes unchanged, so `ssa.ts`, `passes.ts`, `pe.ts`, `guards.ts`, `rotate.ts` and
  `workbench/programs.ts` needed no edit.
- `src/framework/dataflow/solver.ts`: `depthFirst(graph)` keeps its exported shape and returns the
  library's postorder with `retreating.map(e => e.to)` as loop heads. Only `depthFirst` changed, as
  the brief's scope says.

## Step 4: probes and tests

- `scripts/01-graph-primitives.mjs` prints every primitive's answer on the four test graphs; the
  test's expectations are read off it and then checked by hand. Two of my hand predictions were
  wrong and the probe corrected them: `a` *does* dominate `d` in graph A (a is on the only path to
  the header), and the irreducible graph converges in 2 rounds, not 3.
- `tests/stdlib/graph.test.mjs`: 8 tests — the loop with a preheader (orders, dominators, tree,
  `dominates` pairs, the loop), the same loop with two outside predecessors (no preheader), an
  unreachable block and an unreachable self-loop (absent from the orders and `idom`, reflexive
  dominance, the natural loop of an unreachable header), two back edges to one header (one loop, two
  latches, union body), an irreducible two-entry cycle (retreating edge, no loop), the framework
  client, and Typed's analyses against the library on `blend` and `regex-nfa` (rpo, `idom`, rounds,
  children, every `dominates` pair, every loop field). No assertion was weakened; nothing existing
  asserted the old internals.
- `tests/framework/layering.test.mjs`: the import rule narrowed to allow `stdlib/` (see step 1).
  `tests/stdlib/layering.test.mjs`: one added test that the index exports the graph primitives.

## Step 5: acceptance (efd1a73)

- `tests/stdlib/*.test.mjs`: 16 tests, 16 pass (`graph` 8, `liveness` 5, `layering` 3).
- Suites: framework 243/243, typed 188 with 186 pass and 2 skipped, workbench 25 with 24 pass and 1
  skipped, tensor without `*-gpu` 45/45. No failures.
- Baselines after `npm run build`: `no differences` — RV32 image hashes, instruction counts, edit
  records, CUDA sources and `optimizeTix` revisions unchanged (4m-ish run), so the move is
  behaviour-preserving on the whole corpus.
- `npm run check` clean; Prettier clean on every file this step touched (the nine files
  `format:check` warns about were unformatted before); `node tools/build-site.mjs` builds (3109 KiB
  bundle, 50 projects, 17 chapters, 131 source files).
- One mis-run worth recording: `node --test tests/tensor/*.test.mjs` runs the `*-gpu` files too and
  one failed for lack of a GPU; re-ran with the GPU files filtered out (45/45).
