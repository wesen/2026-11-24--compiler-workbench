/**
 * Liveness by backward gen/kill dataflow, over a shape of numbered blocks and numbered items and variables of any
 * type. Nothing here knows what a block, an item or a variable is.
 *
 *   liveOut(b) = union of liveIn(s) over the successors s of b
 *   liveIn(b)  = upward-exposed uses of b, union the later-live variables of b that b does not define
 *
 * A variable is live at a point when some path from that point to a use of it passes no definition of it. The
 * least fixpoint of the two equations over sets gives the point's live set: `liveIn` and `liveOut` per block, and by
 * `walkBackwards` the live set after each item of a block.
 *
 * Scope. The equations say nothing about the entry: a block that no path from the entry reaches still has
 * successors, and its live-out is still the union of their live-ins. Liveness over the machine code a backend emits
 * is that liveness — the block's instructions are in the image, so an interval that ignores them may be given a
 * register they use — while the liveness of the executions that happen gives an unreachable block nothing at all.
 * The two disagree, and only on unreachable blocks:
 *
 *   block 0  j join          block 1 (unreachable)  j join          join: add rd66, r64, r65
 *
 * The join uses r64 and r65, so its live-in is {64, 65}, so block 1's live-out is {64, 65} with scope 'all' and {}
 * with 'entryReachable'. A backward problem cannot let an unreachable predecessor change a reachable block's facts
 * (the predecessor's facts are derived from the successor's, not the other way round), so the reachable part is the
 * same either way; the caller states which scope it asks for, and there is no default.
 *
 * Admission (IRWB-039 phase 2): a named theory (liveness, gen/kill dataflow), two clients (the register allocator's
 * intervals and the copy coalescer, both in `src/typed/backend/`), an executable test (`tests/stdlib/liveness.test.mjs`)
 * and a pure synchronous function.
 */

/**
 * The shape the primitive needs: a finite graph of blocks, each a range of item positions, with the variables each
 * item reads and writes. Successors are block indices; items are positions in `0 .. blockCount`'s blocks.
 */
export interface LivenessShape<V> {
  /** Number of blocks; block indices are 0 .. blockCount-1. */
  readonly blockCount: number;
  /** Successor block indices of `block`. */
  successors(block: number): readonly number[];
  /** The items of `block`: `start` and `end` are item positions, inclusive. A block has at least one item. */
  items(block: number): { readonly start: number; readonly end: number };
  /** The variables the item reads. Called more than once per item: return a re-iterable, not an iterator. */
  reads(item: number): Iterable<V>;
  /** The variables the item writes. Called more than once per item: return a re-iterable, not an iterator. */
  writes(item: number): Iterable<V>;
}

/**
 * Which blocks liveness is computed for.
 *
 *   'all'             every block, whether or not a path from the entry reaches it (the code as laid out)
 *   'entryReachable'  only blocks on a path from `entry`; the others have no liveness (`{}` into and out of them)
 */
export type LivenessScope =
  | { readonly blocks: 'all' }
  | { readonly blocks: 'entryReachable'; readonly entry: number };

export interface Liveness<V> {
  /** Variables live into each block, indexed by block. */
  readonly liveIn: readonly ReadonlySet<V>[];
  /** Variables live out of each block, indexed by block. */
  readonly liveOut: readonly ReadonlySet<V>[];
  /**
   * Visit the items of `block` newest first, giving each the variables live after it. The set is the sweep's working
   * set: it is valid only during the call and must not be modified.
   */
  walkBackwards(block: number, visit: (item: number, liveAfter: ReadonlySet<V>) => void): void;
}

const sameSet = <V>(a: ReadonlySet<V>, b: ReadonlySet<V>): boolean =>
  a.size === b.size && [...a].every(x => b.has(x));

/** Blocks a depth-first walk from `entry` over `successors` reaches. */
function reachableFrom<V>(shape: LivenessShape<V>, entry: number): boolean[] {
  const seen = new Array<boolean>(shape.blockCount).fill(false);
  const stack = [entry];
  seen[entry] = true;
  while (stack.length) {
    for (const s of shape.successors(stack.pop()!)) {
      if (!seen[s]) {
        seen[s] = true;
        stack.push(s);
      }
    }
  }
  return seen;
}

export function liveness<V>(shape: LivenessShape<V>, scope: LivenessScope): Liveness<V> {
  const n = shape.blockCount;
  const visited = scope.blocks === 'all' ? null : reachableFrom(shape, scope.entry);
  // upward-exposed uses and definitions per block, in item order
  const use: Set<V>[] = [],
    def: Set<V>[] = [];
  for (let b = 0; b < n; b++) {
    const u = new Set<V>(),
      d = new Set<V>();
    const { start, end } = shape.items(b);
    for (let i = start; i <= end; i++) {
      for (const v of shape.reads(i)) if (!d.has(v)) u.add(v);
      for (const v of shape.writes(i)) d.add(v);
    }
    use.push(u);
    def.push(d);
  }
  // the least fixpoint, by sweeps in reverse block order until no block changes
  const liveIn: Set<V>[] = [],
    liveOut: Set<V>[] = [];
  for (let b = 0; b < n; b++) {
    liveIn.push(new Set<V>());
    liveOut.push(new Set<V>());
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (let b = n - 1; b >= 0; b--) {
      if (visited && !visited[b]) continue;
      const out = new Set<V>();
      for (const s of shape.successors(b)) for (const v of liveIn[s]) out.add(v);
      const inn = new Set<V>(use[b]);
      for (const v of out) if (!def[b].has(v)) inn.add(v);
      if (!sameSet(inn, liveIn[b]) || !sameSet(out, liveOut[b])) {
        liveIn[b] = inn;
        liveOut[b] = out;
        changed = true;
      }
    }
  }
  return {
    liveIn,
    liveOut,
    walkBackwards(block, visit) {
      const { start, end } = shape.items(block);
      const live = new Set<V>(liveOut[block]);
      for (let i = end; i >= start; i--) {
        visit(i, live);
        for (const v of shape.writes(i)) live.delete(v);
        for (const v of shape.reads(i)) live.add(v);
      }
    },
  };
}
