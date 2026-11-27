/**
 * Backward gen/kill liveness over a control-flow graph: the first primitive of the standard library
 * (IRWB-039 phase 2b, IRWB-046-B). A value is live at a point if some path from that point to an exit
 * reads it before redefining it; per block, `in = uses ∪ (out \ defs)` and `out = ∪ in[succ]`, solved
 * from the empty sets by backward sweeps until nothing changes. The least fixpoint of this monotone
 * system is unique, so the sweep order cannot change any block's sets.
 *
 * The scope says which blocks the equations run over, because that is where liveness implementations
 * disagree: a block no path from the entry reaches still has successors, and 'all-blocks' computes
 * its live-out from them (machine liveness: the block is laid out and its registers still need
 * allocating) while 'entry-reachable' leaves it the empty set, as the framework's solver does. The
 * two differ only on such blocks — a reachable block's successors are reachable, so no reachable
 * block ever joins a fact from an unreachable one.
 */
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
 * Liveness over `graph` under `scope`. `in` and `out` hold one set per block, in block order; under
 * 'entry-reachable' the sets of a block no path reaches are empty. Values live past the last use
 * (into the entry, backwards) are not reported: liveness stops at the block boundaries of the graph.
 */
export function liveness(graph: LiveGraph, scope: LivenessScope): Liveness {
  const blocks = graph.blocks;
  const solve = scope === 'all-blocks' ? null : reachableBlocks(graph);
  const use = blocks.map(b => b.uses),
    def = blocks.map(b => b.defs);
  const IN = blocks.map(() => new Set<number>()),
    OUT = blocks.map(() => new Set<number>());
  for (let changed = true; changed; ) {
    changed = false;
    for (let k = blocks.length - 1; k >= 0; k--) {
      if (solve && !solve.has(k)) continue;
      const out = new Set<number>();
      for (const s of blocks[k].succ) for (const r of IN[s]) out.add(r);
      const inn = new Set(use[k]);
      for (const r of out) if (!def[k].has(r)) inn.add(r);
      // Facts only grow (the join is union and the start is empty), so size is an equality test.
      if (inn.size !== IN[k].size || out.size !== OUT[k].size) {
        IN[k] = inn;
        OUT[k] = out;
        changed = true;
      }
    }
  }
  return { in: IN, out: OUT };
}
