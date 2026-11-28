---
Title: 'stdlib/graph: one digraph interface, four primitives, two clients'
Ticket: IRWB-047-B
Status: complete
Topics:
    - compiler
    - ir
    - typescript
DocType: design
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/stdlib/graph/digraph.ts
      Note: the Digraph interface and the derived predecessor lists
    - Path: repo://src/stdlib/graph/orders.ts
      Note: postorder, reverse postorder, retreating edges
    - Path: repo://src/stdlib/graph/dominators.ts
      Note: immediate dominators (Cooper, Harvey, Kennedy), dominates, the dominator tree
    - Path: repo://src/stdlib/graph/loops.ts
      Note: natural loops, one per header, with all its latches
    - Path: repo://src/typed/analyses.ts
      Note: the Typed-facing adapters (cfgOf, dominatorsOf, domView, loopsOf)
    - Path: repo://src/framework/dataflow/solver.ts
      Note: depthFirst, now the library's order; the framework's only stdlib import
ExternalSources: []
Summary: 'The digraph interface, the four primitives, the two clients and the one framework layering rule this step changes.'
LastUpdated: 2026-11-27
WhatFor: 'The design of IRWB-047-B (IRWB-039 phase 2c, graph part).'
WhenToUse: 'Before changing src/stdlib/graph, Typed’s analyses or the framework solver’s depth-first order.'
---

# stdlib/graph: one digraph interface, four primitives, two clients

IRWB-039 phase 2c: "Graph, lattice, ssa, moved from `typed/analyses.ts` … and the framework
solver's helpers, not rewritten." This step is the graph part. Three algorithms, six procedures,
all of them already in the repository, all of them moving.

| primitive | today | clients |
|---|---|---|
| postorder, reverse postorder, retreating edges | `cfgOf` (`src/typed/analyses.ts:77`), `depthFirst` (`src/framework/dataflow/solver.ts:64`) | Typed's analyses, the framework's dataflow solver |
| immediate dominators, dominator tree, `dominates` | `dominatorsOf`, `domView` (`src/typed/analyses.ts:142-200`) | Typed's analyses, through them `src/typed/ssa.ts`, `passes.ts`, `src/workbench/programs.ts` |
| natural loops, one per header | `loopsOf` (`src/typed/analyses.ts:217`) | Typed's `passes.ts` (licm, rotate), `pe.ts`, `guards.ts` |

## The interface: one digraph, generic in the node

```ts
export interface Digraph<N> {
  readonly nodes: readonly N[];
  readonly entry: N;
  succ(node: N): readonly N[];
}
```

Nodes, an entry, successors — what the brief fixes. Two decisions inside it:

- **Generic in `N`, not `number`.** The liveness primitive (IRWB-046-B) numbers its values; these
  two clients name their blocks with strings (`bb:blend.1`, and the framework's `FlowGraph` labels).
  A numbered interface would force both clients to build an index map and translate every result
  back — an adapter as large as the algorithm — which the design doc's 2c decision point says is the
  case to keep a domain copy for. The generic costs one type parameter and one `Map` key type.
- **Predecessors are derived, not passed.** Only `naturalLoops` needs them, and `succ` determines
  them: `predecessors(graph)` lists them in `nodes` order. A `preds` in the interface would be a
  second source of truth for the same graph, and Typed's `cfgOf` already shows what that costs (it
  builds both records and lets them disagree on undeclared targets).

Input domain, as the brief states it: a finite graph whose successors are nodes of the graph. The
entry is a node. Every primitive returns only reachable nodes except where noted (the loops).

## The primitives

```ts
export function depthFirst<N>(graph: Digraph<N>): DfsOrder<N>;        // { postorder, rpo, retreating }
export function dominators<N>(graph: Digraph<N>): Dominators<N>;      // { idom, rpo, rounds }
export function dominates<N>(idom: ReadonlyMap<N, N | null>, a: N, b: N): boolean;
export function dominatorTree<N>(idom: ReadonlyMap<N, N | null>): Map<N, N[]>;
export function naturalLoops<N>(graph: Digraph<N>): NaturalLoop<N>[]; // header, latches, body, exits, preheader
```

- **depthFirst** is the framework solver's walk, moved: an explicit stack that marks a node active
  when pushed and appends it to the postorder when its last successor is done. It adds nothing to
  that walk except recording each edge to an active node — the *retreating edges*. `rpo` is the
  postorder reversed, `rpo[0]` the entry, so a client that wants an order and a client that wants
  loop heads (`retreating.map(e => e.to)`) both use one traversal. Typed's recursive `dfs` in
  `cfgOf` produced the same postorder; the recursive copy is deleted.
- **dominators** is Cooper, Harvey and Kennedy's iteration, moved with its round counter: one sweep
  of the reverse postorder per round, `meet` climbing the two datums by RPO index, until a sweep
  changes nothing. Two conventions are kept because Typed's stored facts and `ssa.ts` depend on
  them: the entry's immediate dominator is itself, and unreachable nodes have no entry at all.
- **dominates** climbs immediate dominators from `b`, so it is linear in the depth of the dominator
  tree. An unreachable `b` is dominated only by itself — the climb ends where the map has no entry.
- **dominatorTree** inverts `idom` into children lists, in `idom` order (entry first, then RPO):
  Typed's `domView.children`, which the workbench stores as a fact.
- **naturalLoops** takes the dominators it needs (`dominators(graph)` internally), finds the back
  edges `b -> h` with `h` dominating `b`, groups them by header (IRWB-034-G: a loop with a
  `continue`, or a dispatch loop whose every arm jumps back, has several latches, and one loop per
  back edge gave them one id and bodies that exclude each other's latches), and builds each body by
  walking predecessors back from the latches. `preheader` is the identifier of the single node
  outside the body whose only successor is the header, or `null`.

Admission rule (R3): each is a named theory (depth-first search; Cooper-Harvey-Kennedy; natural
loops), with two clients each (Typed's analyses and the framework solver for the orders; Typed's
dominators analysis via `ssa`/`passes`/`workbench` for the dominators; Typed's licm/rotate/pe for
the loops), and each has an executable test in `tests/stdlib/graph.test.mjs`. One input on which a
careless extraction changes meaning is named per primitive in that test: an unreachable block
(absent from the orders and the dominators, present in neither) and a self-loop on an unreachable
block (a natural loop under `dominates(s, s)`, which the moved code has always reported).

### What stays out of the library

`assigned` (a loop's assigned locals) is read off Typed's statement IR, so it stays in `loopsOf`;
the library's `NaturalLoop` has no idea what a local is. The loop `id` (`loop:${f.name}@${header}`)
is a Typed naming convention, so it is built in the adapter. This keeps every adapter a mapping
over fields, not an algorithm.

## The two clients

**Typed's analyses** keep their public shapes — `Cfg`, `Dominators` (finite JSON: `idom` as a
record, `rpo`, `rounds`), `DomView` (`idom` map, `dominates`, `children`), `Loop` with `id`/`head`/
`assigned` — and call the library through one private helper, `digraphOf(f)`, which builds the
digraph and the successor/predecessor records in one pass:

- `cfgOf`: `rpo` is `depthFirst(digraphOf(f)).rpo`; `succ`, `preds`, `edges` unchanged.
- `dominatorsOf`: the library's result, with `idom` flattened to a record for the facts.
- `domView`: `dominates` and `children` are the library's queries on the record's map.
- `loopsOf`: the library's loops, each renamed (`header` -> `head`), given an `id` and its
  `assigned` locals.

Byte-identical argument: every primitive computes what the code it replaces computed, in the same
order — same successor order (Typed's are already declared blocks; the digraph filters undeclared
targets exactly as `cfgOf`'s DFS did), same postorder (the recursive and the stack walk agree), same
`idom` insertions and round count (same sweep, same meet order), same latch and body insertion
order (the backward walk pops in the same order). Typed's facts are serialised, and LICM iterates
`body` and `latches` in that order, so the order is part of the contract; the baselines check
(RV32 images, instruction counts, edit records, CUDA sources) is the evidence.

**The framework's solver** keeps `depthFirst(graph: FlowGraph)` as its exported shape — `{ postorder:
string[]; loopHeads: Set<string> }` — and returns the library's order with the retreating edges'
targets as the head set. This makes the framework import `src/stdlib`, which its layering test
forbade ("framework sources import nothing outside src/framework"). The rule becomes: the framework
may use the library, which imports nothing outside itself, and may still import no domain. That is
the direction the design doc's 2c intends (`the framework solver's helpers` move to the library and
the solver keeps calling them); a domain copy left behind would be the duplication this step exists
to remove. `tests/framework/layering.test.mjs` is updated to say so, and
`tests/stdlib/layering.test.mjs` already forbids the reverse direction, so the two rules cannot
form a cycle.

## Tests

`tests/stdlib/graph.test.mjs`, on named nodes, each expectation written out:

1. a diamond with a loop: exact `postorder`, `rpo`, `retreating`, `idom`, `dominates` pairs,
   `dominatorTree`, and the loop (header, one latch, body order, exits, preheader);
2. an unreachable block and an unreachable self-loop: absent from the orders, absent from `idom`,
   `dominates(u, u)` true and no other node dominating it, no children key, one natural loop with an
   unreachable header (what the moved code has always reported);
3. a loop with two back edges to one header (`continue` shape): one loop, two latches in node order,
   a body that is the union (the IRWB-034-G fix), exits from both arms, preheader `null` (two
   outside predecessors);
4. an irreducible two-entry cycle: no dominance back edge, so no natural loop, while the DFS still
   reports the retreating edge `b -> a` — the difference between a retreating edge and a natural
   loop's back edge, stated;
5. the framework client: `depthFirst(flowGraph)` on the same graph returns the library's postorder
   and the retreating targets as loop heads;
6. the Typed client: `cfgOf`/`dominatorsOf`/`loopsOf` on a corpus function agree with the library on
   the same blocks (the adapter adds only `id`/`assigned`).

`tests/stdlib/layering.test.mjs` and `tests/framework/layering.test.mjs` bound the imports both ways.
