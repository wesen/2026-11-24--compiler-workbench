/**
 * Backward gen/kill liveness over a control-flow graph: the first primitive of the standard library
 * (IRWB-039 phase 2b, IRWB-046-B). A value is live at a point if some path from that point to an exit
 * reads it before redefining it; per block, `in = uses ∪ (out \ defs)` and `out = ∪ in[succ]`.
 *
 * Since IRWB-053-B the fixpoint is the library's own solver (`flow/solver.ts`) with the set lattice
 * (`lattice/lattices.ts`): the equations above are its backward direction, the transfer is the `in`
 * formula, and the join is union, so the old hand-written sweep is gone. The solver returns the least
 * fixpoint of a monotone system, which is unique, so no sweep order can change any block's sets.
 *
 * The scope says which blocks the equations run over, because that is where liveness implementations
 * disagree: a block no path from the entry reaches still has successors, and 'all-blocks' computes
 * its live-out from them (machine liveness: the block is laid out and its registers still need
 * allocating) while 'entry-reachable' leaves it the empty set, as the solver itself does. The two
 * differ only on such blocks — a reachable block's successors are reachable, so no reachable block
 * ever joins a fact from an unreachable one.
 *
 * 'all-blocks' is the one shape the solver does not state: it walks from an entry and stops at what
 * that entry reaches. So the graph handed to it under that scope carries one extra, phantom block last,
 * whose successors are every block and whose own facts are dropped; the walk from it reaches every
 * block, and the extra block's transfer is the identity (it is not a block of `blocks`). Under
 * 'entry-reachable' the solver's entry is `graph.entry` and no phantom is needed.
 */
import { setLattice } from '../lattice/lattices.js';
import { solve } from './solver.js';

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

/** The phantom block 'all-blocks' adds: 'all' is no block index, so its transfer is the identity. */
const PHANTOM = 'all';

/**
 * Liveness over `graph` under `scope`. `in` and `out` hold one set per block, in block order; under
 * 'entry-reachable' the sets of a block no path reaches are empty. Values live past the last use
 * (into the entry, backwards) are not reported: liveness stops at the block boundaries of the graph.
 */
export function liveness(graph: LiveGraph, scope: LivenessScope): Liveness {
  const blocks = graph.blocks,
    n = blocks.length;
  if (!n) return { in: [], out: [] };
  // The solver's nodes are the block indices as strings.
  const id = blocks.map((_, k) => String(k));
  const succ = blocks.map(b => b.succ.map(s => id[s])),
    preds: string[][] = id.map(() => []);
  blocks.forEach((b, k) => {
    for (const s of b.succ) preds[s].push(id[k]);
  });
  const allBlocks = scope === 'all-blocks';
  const nodes = allBlocks ? [...id, PHANTOM] : [...id];
  const flow = {
    entry: allBlocks ? PHANTOM : id[graph.entry ?? 0],
    blocks: nodes,
    succ: (b: string) => (b === PHANTOM ? id : succ[Number(b)]),
    preds: (b: string) => (b === PHANTOM ? [] : preds[Number(b)]),
  };
  const sets = setLattice<number>();
  const solution = solve(flow, {
    direction: 'backward',
    lattice: sets,
    // in = uses ∪ (out \ defs); the phantom block is not a block.
    transfer: (b, out) => {
      const k = Number(b);
      if (!blocks[k]) return out;
      const { uses, defs } = blocks[k],
        live = new Set(uses);
      for (const r of out) if (!defs.has(r)) live.add(r);
      return live;
    },
  });
  const bottom = sets.bottom();
  return {
    in: id.map(b => solution.in.get(b) ?? bottom),
    out: id.map(b => solution.out.get(b) ?? bottom),
  };
}
