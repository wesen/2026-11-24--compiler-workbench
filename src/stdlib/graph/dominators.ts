/**
 * Immediate dominators by Cooper, Harvey and Kennedy's iterative algorithm (IRWB-047-B), with the dominator tree
 * and the dominance query as the two ways a client reads the result.
 *
 * A node `d` dominates `b` when every path from the entry to `b` goes through `d`; the *immediate* dominator of `b`
 * is the dominator of `b` that no other dominator of `b` dominates. The algorithm computes them in one sweep per
 * round over the reverse postorder — so that a node's predecessors have been seen before it — meeting the
 * processed predecessors by climbing the two datums up the reverse-postorder index until they agree, and repeating
 * until a sweep changes no node. It terminates on every finite graph (each round only moves immediate dominators
 * up the reverse postorder), so the result is the same whatever order the sweep visits predecessors in; only the
 * round count, which the analysis records as evidence of how much work it did, depends on it.
 *
 * Conventions, kept from Typed's analyses because its stored facts and its SSA construction depend on them:
 * the entry's immediate dominator is itself (so a climb up the tree always ends), and a node no path from the
 * entry reaches has no entry at all — `idom.has(u)` is false and the only node dominating `u` is `u` itself.
 */
import type { Digraph } from './digraph.js';
import { predecessors } from './digraph.js';
import { depthFirst } from './orders.js';

export interface Dominators<N> {
  /** `idom` maps each reachable node to its immediate dominator; the entry maps to itself. Unreachable: absent. */
  readonly idom: ReadonlyMap<N, N | null>;
  /** The reverse postorder the iteration swept: `rpo[0]` is the entry, and unreachable nodes are absent. */
  readonly rpo: readonly N[];
  /** The sweeps of the reverse postorder until a sweep changed nothing. */
  readonly rounds: number;
}

export function dominators<N>(graph: Digraph<N>): Dominators<N> {
  const { rpo } = depthFirst(graph);
  const index = new Map<N, number>(rpo.map((n, i) => [n, i])),
    preds = predecessors(graph),
    entry = rpo[0],
    idom = new Map<N, N>([[entry, entry]]);
  /** The common dominator of two nodes, both of which have an immediate dominator: climb to the same node. */
  const meet = (a: N, b: N): N => {
    while (a !== b) {
      while (index.get(a)! > index.get(b)!) a = idom.get(a)!;
      while (index.get(b)! > index.get(a)!) b = idom.get(b)!;
    }
    return a;
  };
  let rounds = 0;
  for (let changed = true; changed; rounds++) {
    changed = false;
    for (const n of rpo) {
      if (n === entry) continue;
      // only predecessors that are reachable (in `rpo`) and already swept this round can be met; by the
      // reverse postorder every node's depth-first parent is swept before it, so a pick is never empty
      let pick: N | null = null;
      for (const p of preds.get(n)!) if (idom.has(p)) pick = pick === null ? p : meet(p, pick);
      if (pick !== null && idom.get(n) !== pick) {
        idom.set(n, pick);
        changed = true;
      }
    }
  }
  return { idom, rpo, rounds };
}

/**
 * Whether `a` dominates `b`: every path from the entry to `b` goes through `a`. Climbs `b`'s immediate dominators,
 * so it costs the depth of the dominator tree; an unreachable `b` is dominated only by itself, because the climb
 * stops where `idom` has no entry for a node.
 */
export function dominates<N>(idom: ReadonlyMap<N, N | null>, a: N, b: N): boolean {
  let x: N | null | undefined = b;
  while (x !== null && x !== undefined) {
    if (x === a) return true;
    const parent = idom.get(x);
    if (parent === x) return false; // the entry's parent is itself: the climb is over
    x = parent;
  }
  return false;
}

/**
 * The dominator tree as children lists: every reachable node keys the nodes whose immediate dominator it is, in
 * `idom` order (the entry first, then reverse postorder). The entry is a root and is nobody's child.
 */
export function dominatorTree<N>(idom: ReadonlyMap<N, N | null>): Map<N, N[]> {
  const children = new Map<N, N[]>();
  for (const n of idom.keys()) children.set(n, []);
  for (const [child, parent] of idom)
    if (parent !== null && child !== parent) children.get(parent)!.push(child);
  return children;
}
