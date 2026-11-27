/** A finite graph of blocks, with successors expressed as indices into the supplied array. */
export interface LivenessBlock<T> {
  readonly successors: readonly number[];
  /** Values used before their first definition in this block. */
  readonly uses: ReadonlySet<T>;
  readonly definitions: ReadonlySet<T>;
}

/** Least backward gen/kill solution over all supplied blocks, including unreachable blocks. */
export function liveness<T>(blocks: readonly LivenessBlock<T>[]): { liveIn: Set<T>[]; liveOut: Set<T>[] } {
  const liveIn = blocks.map(() => new Set<T>()),
    liveOut = blocks.map(() => new Set<T>());
  for (let changed = true; changed; ) {
    changed = false;
    for (let k = blocks.length - 1; k >= 0; k--) {
      const out = new Set<T>();
      for (const s of blocks[k].successors) for (const value of liveIn[s]) out.add(value);
      const inn = new Set(blocks[k].uses);
      for (const value of out) if (!blocks[k].definitions.has(value)) inn.add(value);
      if (inn.size !== liveIn[k].size || out.size !== liveOut[k].size) {
        liveIn[k] = inn;
        liveOut[k] = out;
        changed = true;
      }
    }
  }
  return { liveIn, liveOut };
}
