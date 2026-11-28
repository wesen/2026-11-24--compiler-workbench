/**
 * Natural loops, one per header, with all of the header's latches (IRWB-047-B; the grouping is IRWB-034-G's fix).
 *
 * A *back edge* is an edge `latch -> header` whose target dominates its source: every path into the loop from
 * outside goes through the header, which is what makes the loop natural and lets a header get one preheader. The
 * loop of that edge is the header plus every node that reaches the latch without passing the header again — the
 * backward walk over predecessors from the latch, stopping at the header. Two back edges with the same header are
 * one loop: a loop with a `continue`, or a dispatch loop whose every arm jumps back, has several latches, and one
 * loop per back edge gave them one id and bodies that excluded each other's latches, so a preheader made for one
 * of them sat on the others' back edges and ran every iteration. The loop's body is the union of its back edges'
 * bodies, its latches are all of their sources in node order, and its exits are the edges leaving the body.
 *
 * The header's preheader is the single node outside the body whose only successor is the header, or `null` when
 * there is no such node or more than one (a header with two outside predecessors has no single place to put work
 * that must run once per iteration). That is an identifier, so the caller decides whether a new block is needed.
 *
 * What this primitive does not see: an irreducible cycle — two entries neither of which dominates the other — has
 * no dominance back edge and therefore no natural loop, even though the depth-first walk reports retreating edges
 * inside it (`depthFirst`'s `retreating`). And dominance is reflexive, so a self-loop on a node no path from the
 * entry reaches is a natural loop of that unreachable header: nothing here filters on reachability.
 */
import type { Digraph } from './digraph.js';
import { predecessors } from './digraph.js';
import { dominates, dominators } from './dominators.js';

export interface NaturalLoop<N> {
  /** The only node of the loop that a path from outside the loop into it must reach. */
  readonly header: N;
  /** The sources of the header's back edges, in `graph.nodes` order, each once. */
  readonly latches: readonly N[];
  /** The header and the nodes that reach a latch inside the loop, in the order the backward walk found them. */
  readonly body: readonly N[];
  /** The nodes outside the body that a body node jumps to, first occurrence kept. */
  readonly exits: readonly N[];
  /** The node outside the body whose only successor is the header, or `null`; see the module comment. */
  readonly preheader: N | null;
}

export function naturalLoops<N>(graph: Digraph<N>): NaturalLoop<N>[] {
  const { idom } = dominators(graph),
    preds = predecessors(graph),
    latches = new Map<N, N[]>();
  for (const b of graph.nodes)
    for (const s of graph.succ(b))
      if (dominates(idom, s, b)) {
        const group = latches.get(s);
        if (!group) latches.set(s, [b]);
        else if (!group.includes(b)) group.push(b);
      }
  const out: NaturalLoop<N>[] = [];
  for (const [header, group] of latches) {
    const body = new Set<N>([header]),
      work = [...group];
    while (work.length) {
      const x = work.pop()!;
      if (body.has(x)) continue;
      body.add(x);
      work.push(...preds.get(x)!);
    }
    const outside = preds.get(header)!.filter(q => !body.has(q)),
      preheader = outside.length === 1 && graph.succ(outside[0]).length === 1 ? outside[0] : null,
      exits = new Set<N>();
    for (const x of body) for (const y of graph.succ(x)) if (!body.has(y)) exits.add(y);
    out.push({ header, latches: group, body: [...body], exits: [...exits], preheader });
  }
  return out;
}
