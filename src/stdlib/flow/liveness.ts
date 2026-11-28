/**
 * Backward gen/kill liveness over a control-flow graph: the first primitive of the standard library
 * (IRWB-039 phase 2b, IRWB-046-B), solved on the library's fixpoint solver since IRWB-053-A. A value
 * is live at a point if some path from that point to an exit reads it before redefining it; per
 * block, `in = uses ∪ (out \ defs)` and `out = ∪ in[succ]`, solved backwards over the set lattice
 * from the empty sets to the least fixpoint. The least fixpoint of this monotone system is unique, so
 * the schedule cannot change any block's sets.
 *
 * The scope says which blocks the equations run over, because that is where liveness implementations
 * disagree: a block no path from the entry reaches still has successors, and 'all-blocks' computes
 * its live-out from them (machine liveness: the block is laid out and its registers still need
 * allocating) while 'entry-reachable' leaves it the empty set, as the solver does. The two differ only
 * on such blocks — a reachable block's successors are reachable, so no reachable block ever joins a
 * fact from an unreachable one.
 *
 * 'all-blocks' on a solver that walks from the entry: the walk must reach the unreachable blocks
 * without letting their facts flow anywhere, so the flow graph handed to `solve` carries one fake edge
 * entry -> u per unreachable u, and the `edge` function maps exactly those edges to bottom. A fake
 * edge makes u visited (its own equations still run over its real successors) but contributes nothing
 * to the entry's live-out — and a real edge from the entry cannot reach an unreachable block, so
 * "from the entry, to an unreachable block" identifies the fake edges exactly.
 */
import { solve, type FlowGraph } from './solve.js';
import { setLattice } from '../lattice/lattices.js';

export interface LiveBlock {
  /** Values the block reads before defining them (upward-exposed uses), not every value it reads. */
  readonly uses: ReadonlySet<number>;
  /** Values the block defines. */
  readonly defs: ReadonlySet<number>;
  /** Indices of the successor blocks in `LiveGraph.blocks`. */
  readonly succ: readonly number[];
}

export interface LiveGraph {
  readonly blocks: readonly LiveBlock[];
  /** The entry block's index; block 0 unless another index is given. */
  readonly entry?: number;
}

/** Which blocks the equations run over; see the module comment. */
export type LivenessScope = 'all-blocks' | 'entry-reachable';

export interface Liveness {
  /** Values live into each block (`blocks[i]` -> live set); live out of the entry's predecessors. */
  readonly in: ReadonlySet<number>[];
  readonly out: ReadonlySet<number>[];
}

/** The blocks a path from the entry reaches. */
export function reachableBlocks(graph: LiveGraph): ReadonlySet<number> {
  const seen = new Set<number>(),
    stack = [graph.entry ?? 0];
  while (stack.length) {
    const b = stack.pop()!;
    if (seen.has(b)) continue;
    seen.add(b);
    for (const s of graph.blocks[b].succ) if (!seen.has(s)) stack.push(s);
  }
  return seen;
}

/**
 * Liveness over `graph` under `scope`, as one backward fixpoint over the set lattice. `in` and `out`
 * hold one set per block, in block order; under 'entry-reachable' the sets of a block no path reaches
 * are empty. Values live past the last use (into the entry, backwards) are not reported: liveness
 * stops at the block boundaries of the graph.
 */
export function liveness(graph: LiveGraph, scope: LivenessScope): Liveness {
  const blocks = graph.blocks,
    entry = graph.entry ?? 0;
  const use = blocks.map(b => b.uses),
    def = blocks.map(b => b.defs);
  const succ: string[][] = blocks.map(b => b.succ.map(String));
  const preds: string[][] = blocks.map(() => []);
  blocks.forEach((b, k) => {
    for (const s of b.succ) preds[s].push(String(k));
  });
  const reachable = reachableBlocks(graph);
  const faked = scope === 'all-blocks' ? blocks.map((_, k) => k).filter(k => !reachable.has(k)) : [];
  for (const u of faked) (succ[entry].push(String(u)), preds[u].push(String(entry)));
  const fake = new Set(faked.map(String));
  const flow: FlowGraph = {
    entry: String(entry),
    blocks: blocks.map((_, k) => String(k)),
    succ: b => succ[Number(b)],
    preds: b => preds[Number(b)],
  };
  const solution = solve(flow, {
    direction: 'backward',
    lattice: setLattice<number>(),
    transfer: (b, out) => {
      const k = Number(b),
        inn = new Set(use[k]);
      for (const r of out) if (!def[k].has(r)) inn.add(r);
      return inn;
    },
    edge:
      fake.size > 0
        ? (from, to, v) => (from === String(entry) && fake.has(to) ? new Set<number>() : v)
        : undefined,
  });
  const empty = new Set<number>();
  return {
    in: blocks.map((_, k) => solution.in.get(String(k)) ?? empty),
    out: blocks.map((_, k) => solution.out.get(String(k)) ?? empty),
  };
}
