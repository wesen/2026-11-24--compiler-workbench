---
Title: 'Report: graph in the standard library'
Ticket: IRWB-047-A
Status: complete
Topics:
    - stdlib
    - graph
    - dataflow
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "What IRWB-047-A built: src/stdlib/graph with depth-first orders, CHK dominators and natural loops over one Digraph; Typed's analyses and the framework solver on it; baselines unchanged."
LastUpdated: 2026-11-27
WhatFor: "The report of IRWB-047-A."
WhenToUse: "Reviewing what the graph step of the standard library delivered."
---

# Report: graph in the standard library

## What changed

- `src/stdlib/graph/orders.ts` — new: the `Digraph` interface (nodes, an entry, successors — never a
  domain's blocks) and `depthFirst`, one walk returning the postorder, the reverse postorder and the
  retreating edges (target still on the walk's path); successors outside `nodes` are not walked. The
  iterative walk is the framework solver's, so both old walks (the solver's and `cfgOf`'s recursive
  one, which produce the same orders) are covered by it.
- `src/stdlib/graph/dominators.ts` — new: `dominators` (Cooper, Harvey and Kennedy's iteration,
  moved verbatim — the idom map's insertion order and `rounds` are published facts), `domTree`
  (children in the facts' key order, and the walk-based `dominates` query), and `naturalLoops`
  (back edges by dominance, one loop per header with all its latches, body by the predecessors
  walk). Predecessors are derived from `succ` inside the module.
- `src/stdlib/index.ts` — exports the graph module; `graph` moves from the "later modules" list to
  "what exists now".
- `src/typed/analyses.ts` — `cfgOf` takes the rpo from `depthFirst`; `dominatorsOf` and `domView`
  are thin adapters over `dominators`/`domTree` (the `Dominators` and `DomView` types stay where
  callers need them; `DomView.children` narrows to `readonly string[]`); `loopsOf` takes head,
  latches and body from `naturalLoops` and keeps the Typed material (preheaders, exits, assigned
  locals); new exported `digraphOf(f)` — `typed.blocks` as a `Digraph`. The old copies are deleted.
- `src/typed/ssa.ts` — calls `dominators(digraphOf(f))` directly (it consumed only the idom map, now
  read as `d.idom.get(b)`), so it is the dominators module's second client beside the analyses.
- `src/framework/dataflow/solver.ts` — `depthFirst` becomes an adapter over the library walk:
  postorder for the sweeps, and the retreating edges' targets as the loop-head set widening sits on
  (unchanged widening sites). Its `postorder` return narrows to `readonly string[]` (nothing
  mutates it). This is the only change in `src/framework/`.
- `tests/framework/layering.test.mjs` — **the one existing test this step is meant to change**: it
  asserted `src/framework/**` imports nothing outside `src/framework`; the boundary is now
  `src/framework` and `src/stdlib`, because the v7 plan's phase 2c moves "the framework solver's
  helpers" into the library and the library sits below the framework (it imports nothing but
  itself). The stdlib layering test is unchanged and still passes.
- `tests/stdlib/graph.test.mjs` — new: every primitive on small graphs with hand-computed answers,
  and the three required cases with a statement per primitive: an unreachable block (no order, no
  idom, dominates nothing but itself — and its self-edge is still a back edge, so one one-node
  natural loop, exactly what `loopsOf` published before), a header with two back edges (one loop,
  both latches), and an irreducible two-entry cycle (a retreating edge — so the solver widens at
  its target — but no back edge, hence no natural loop). The solver's adapter is pinned too.
- `scripts/01-graph-clients.mjs` — probe: 135 corpus functions; the adapters and the library agree
  on idom and rounds everywhere, every idom dominates its node, every loop head dominates its body
  and latches, and `ssaOf`'s direct call agrees with the published facts.

## Acceptance (on the last commit)

- **Tests** (`node --test`, files not directories): `tests/stdlib/*` 16 pass / 0 fail (9 new graph
  tests among them); `tests/typed/*` 186 pass / 0 fail / 2 skipped (the pre-existing
  `IRWB_CANDELA`-gated pair); `tests/framework/*` 243 pass / 0 fail; `tests/workbench/*` 24 pass /
  0 fail; `tests/tensor/*` except `*-gpu` 45 pass / 0 fail. No assertion was weakened; the one test
  updated is the framework layering boundary above, with the reason.
- **Baselines**: `02-baselines.mjs check` prints `no differences` (RV32 image hashes, instruction
  counts and edit records under r0, O2 and `speed`; CUDA sources and `optimizeTix` revisions).
- **`npm run check`** clean; **`node tools/build-site.mjs`** builds (app.js 3108 KiB). Prettier is
  clean on every file this step touched; 9 untouched files elsewhere in `src/` still drift as
  before this step.

## What is left out, and why

- **Dominance frontiers** stay in `typed/ssa.ts`: they run over the virtual `^entry` block, which is
  Typed's shape, not the library's. When `ssa/` enters the library (phase 2c's next slice), the
  frontier computation moves with it.
- `typed/backend/frequency.ts` keeps its own reverse postorder (it appends the unreachable blocks
  after the reachable ones, a scheduling choice, not the plain order) — a third client candidate
  for `orders` under the admission rule, in a backend file this step's scope does not name.
- `labs/expressions.ts`'s iterative postorder stays: labs are not a compiler domain's client.
- `typed/sccp.ts` and `f32.ts` are other steps' territory and only read `cfgOf`, which is
  unchanged.

## Nothing believed wrong in the brief

One thing the brief understates: the framework's layering test forbade the solver from importing
the library, so "the framework's dataflow solver ... uses the depth-first order" required changing
that boundary, not just the solver. The v7 plan's phase 2c ("the framework solver's helpers" are
moved) says which way it goes, so the change is one line plus a comment.
