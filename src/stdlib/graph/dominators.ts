/**
 * Dominators and the loops they induce (IRWB-039 phase 2c, IRWB-047-A): Cooper, Harvey and
 * Kennedy's iterative dominators over the reverse postorder, the dominator tree with a `dominates`
 * query, and the natural loops — one per header, with all its latches.
 *
 * A back edge is an edge u -> v where v dominates u, and the natural loop of v is v together with
 * every node that can reach u without passing through v (found by walking predecessors from the
 * latches). One loop is reported per header, however many back edges enter it: a loop with a
 * `continue` has several latches, and a loop per back edge would give each half a body that
 * excludes the other half's latches (IRWB-034-G). An irreducible cycle — entered at two nodes
 * neither of which dominates the other — has no back edge under this definition, so it is no
 * natural loop, though the depth-first walk still finds a retreating edge in it: that is where
 * `graph/orders.js`'s retreating edges and this module's back edges part.
 *
 * The idom map is built entry first, then the reachable nodes in reverse postorder of first
 * assignment; callers that publish the map as JSON keep that key order, and `domTree`'s children
 * arrays follow it.
 */
import { depthFirst, type Digraph } from './orders.js';

/** Immediate dominators, as Cooper, Harvey and Kennedy's iteration computes them. */
export interface Dominators {
  /** The immediate dominator of each node a path from the entry reaches; the entry maps to itself. */
  readonly idom: ReadonlyMap<string, string>;
  /** The reachable nodes in reverse postorder, the order the iteration walks in. */
  readonly rpo: readonly string[];
  /** How many sweeps the iteration took until nothing changed. */
  readonly rounds: number;
}

/** What `domTree` reads: the output of `dominators`, or the same facts decoded from storage. */
export interface DominatorFacts {
  readonly idom: ReadonlyMap<string, string | null>;
  readonly rpo: readonly string[];
}

/** Predecessors of every node, one entry per edge, in `nodes` order (repeated edges repeat). */
const predecessorsOf = (graph: Digraph): ReadonlyMap<string, readonly string[]> => {
  const known = new Set(graph.nodes),
    preds = new Map<string, string[]>(graph.nodes.map(n => [n, [] as string[]]));
  for (const u of graph.nodes) for (const v of graph.succ(u)) if (known.has(v)) preds.get(v)!.push(u);
  return preds;
};

export function dominators(graph: Digraph): Dominators {
  const { reversePostorder: rpo } = depthFirst(graph);
  const preds = predecessorsOf(graph);
  const idx = new Map(rpo.map((id, i) => [id, i]));
  const idom = new Map<string, string | null>([[rpo[0], rpo[0]]]);
  const inter = (a: string, b: string) => {
    while (a !== b) {
      while (idx.get(a)! > idx.get(b)!) a = idom.get(a)!;
      while (idx.get(b)! > idx.get(a)!) b = idom.get(b)!;
    }
    return a;
  };
  let changed = true,
    rounds = 0;
  while (changed) {
    changed = false;
    rounds++;
    for (const id of rpo.slice(1)) {
      let n: string | null = null;
      for (const q of preds.get(id) ?? []) if (idom.has(q) && idx.has(q)) n = n === null ? q : inter(q, n);
      if (idom.get(id) !== n) {
        idom.set(id, n);
        changed = true;
      }
    }
  }
  return { idom: idom as ReadonlyMap<string, string>, rpo, rounds };
}

/** The dominator tree: each node's children and a `dominates` query over the immediate dominators. */
export interface DomTree {
  /** The immediate dominator of each node the facts cover; a node no path reaches is absent. */
  readonly idom: ReadonlyMap<string, string | null>;
  /** The nodes `idom` makes children of each node of `rpo`, in the facts' key order. */
  readonly children: ReadonlyMap<string, readonly string[]>;
  /** Whether every path from the entry to `b` passes `a`; a node dominates itself. */
  dominates(a: string, b: string): boolean;
}

export function domTree(d: DominatorFacts): DomTree {
  const idom = d.idom;
  const dominates = (a: string, b: string) => {
    for (;;) {
      if (a === b) return true;
      const x = idom.get(b);
      if (!x || x === b) return false;
      b = x;
    }
  };
  const children = new Map(d.rpo.map(id => [id, [] as string[]]));
  for (const [b, x] of idom) if (x && b !== x) children.get(x)?.push(b);
  return { idom, dominates, children };
}

/** A natural loop: one header, all its latches, and the body they enclose. */
export interface NaturalLoop {
  /** The target of the back edges: the node that dominates every node of the loop. */
  readonly head: string;
  /** Every source of a back edge to `head`, in `nodes` order. */
  readonly latches: readonly string[];
  /** `head`, the latches, and every node on a path from a latch to `head` that leaves `head` only at the end. */
  readonly body: readonly string[];
}

/**
 * The natural loops of `graph`, one per header, in order of first back edge. `dominates` is the
 * query `domTree` builds (or anything with its meaning): the back edges are the edges it accepts.
 */
export function naturalLoops(
  graph: Digraph,
  dominates: (head: string, latch: string) => boolean,
): NaturalLoop[] {
  const preds = predecessorsOf(graph);
  const latchesOf = new Map<string, string[]>();
  for (const b of graph.nodes)
    for (const s of graph.succ(b))
      if (dominates(s, b)) {
        const latches = latchesOf.get(s) ?? [];
        if (!latches.length) latchesOf.set(s, latches);
        if (!latches.includes(b)) latches.push(b);
      }
  const out: NaturalLoop[] = [];
  for (const [s, latches] of latchesOf) {
    const body = new Set<string>([s]),
      work = [...latches];
    while (work.length) {
      const x = work.pop()!;
      if (body.has(x)) continue;
      body.add(x);
      work.push(...(preds.get(x) ?? []));
    }
    out.push({ head: s, latches, body: [...body] });
  }
  return out;
}
