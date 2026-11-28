---
Title: 'Design: graph in the standard library — interface, exactness, clients'
Ticket: IRWB-047-A
Status: complete
Topics:
    - stdlib
    - graph
    - dataflow
DocType: design
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "The Digraph interface, the three moved algorithms, the exactness invariants, and the client rewiring of IRWB-047-A."
LastUpdated: 2026-11-27
WhatFor: "Why src/stdlib/graph looks the way it does."
WhenToUse: "Reviewing or extending the graph module."
---

# Design: graph in the standard library

## What moves (IRWB-039 phase 2c: moved, not rewritten)

- `depthFirst` — one depth-first walk from the entry gives the **postorder**, its reverse
  (**reverse postorder**) and the **retreating edges** (target still on the walk's path). Today
  `cfgOf` (`src/typed/analyses.ts`) computes the rpo with a recursive walk, and the framework
  solver's `depthFirst` (`src/framework/dataflow/solver.ts`) the postorder and loop heads. Both walks
  mark a node before descending and push it to the order after all its successors, so one library
  walk answers both; the two callers' graphs are the same up to each one's edge filtering, which
  stays with the caller.
- `dominators` — Cooper, Harvey and Kennedy's iteration, verbatim, plus `domTree` (children and a
  `dominates` query) — the port of `dominatorsOf` and `domView`.
- `naturalLoops` — back edges by dominance (u → v with v dominating u), **one loop per header with
  all its latches** (IRWB-034-G's fix), body by the predecessors walk — the port of `loopsOf`'s
  graph part. Preheaders, exits and assigned locals stay in Typed: they read statements and the raw
  successor record, which is domain material.

## The interface

```ts
interface Digraph {
  nodes: readonly string[];   // declaration order; the entry is one of them
  entry: string;
  succ(node: string): readonly string[];  // edge order; successors outside `nodes` are not walked
}
```

Predecessors are derived inside the library (nodes in order, one entry per edge, repeats kept) —
they are a function of `succ`, and deriving them reproduces `cfgOf`'s block-order predecessor lists
exactly, which the CHK iteration and the body walk iterate over.

## Exactness (what the baselines pin)

- **Orders.** The library walk is the solver's iterative one (state `active`/`done`, retreating =
  edge to `active`). Membership in `nodes` replaces `cfgOf`'s `!succ[id]` guard against dangling
  successors; `Typed` passes raw successor lists, so the guard must live in the walk.
- **Dominators.** The idom map is built entry-first, then nodes in rpo order of first assignment —
  the same insertion order `dominatorsOf` had — so `Object.fromEntries` keeps the same JSON key
  order and `domTree`'s children arrays keep their order. `rounds` is part of the result (it is a
  published fact).
- **Loops.** Latches in node order, loops in order of first back edge, body in the worklist's
  insertion order (pop-last, push predecessors) — the orders `loopsOf` publishes today.
- **Widening.** The solver's loop heads are the retreating-edge targets, unchanged, so widening
  sites and every sweep are bit-identical.

## Clients (each calls the library; each old copy deleted)

- `src/typed/analyses.ts`: `cfgOf` (rpo), `dominatorsOf`/`domView` (thin adapters over
  `dominators`/`domTree`; the `Dominators`/`DomView` types stay for the facts' JSON shape),
  `loopsOf` (graph part from `naturalLoops`), and a new exported `digraphOf(f)` — `typed.blocks` as
  a `Digraph`.
- `src/typed/ssa.ts`: calls `dominators(digraphOf(f))` directly (it consumed only the idom map).
- `src/framework/dataflow/solver.ts`: `depthFirst` becomes an adapter that maps the library's
  retreating edges to the loop-head set the solver widens at.

## The one test that had to change

`tests/framework/layering.test.mjs` asserted that `src/framework/**` imports nothing outside
`src/framework`. Phase 2c of the v7 plan names "the framework solver's helpers" among the code that
moves into the library, so the boundary becomes: framework imports nothing outside `src/framework`
and `src/stdlib` (the library is below the framework: it imports nothing but itself). The stdlib
layering test is unchanged.

## The trap a careless extraction falls into

An **irreducible cycle** (two entries, neither node dominating the other): the depth-first walk
still finds a retreating edge in it, so a solver widens at its target — but by the dominance
definition there is no back edge, so `naturalLoops` reports no loop there. Depth-first retreating
edges and dominance back edges are different notions; a library that computed loops from the walk
would change Typed's loops facts on such a graph.
