import type { Lattice } from '../lattice/lattices.js';

export interface Equations<K, V> {
  readonly lattice: Lattice<V> & { widen?(old: V, next: V): V };
  /** Pure monotone equation. Read unknowns only through get, during this call. */
  rhs(unknown: K, get: (other: K) => V): V;
  /** Select the unknowns at which the lattice's widening is applied. */
  widenAt?(unknown: K): boolean;
}

export interface Budget {
  /** Non-negative integer limit on right-hand-side evaluations, or Infinity. */
  readonly evaluations: number;
}

export interface Solution<K, V> {
  readonly status: 'stable' | 'exhausted';
  readonly values: ReadonlyMap<K, V>;
  readonly evaluations: number;
  /** Batches started, including a partially evaluated final batch on exhaustion. */
  readonly rounds: number;
}

/**
 * Solve the equations demanded by the roots. Unknowns use Map key identity and start at bottom.
 * Each evaluation replaces its dependency set with the reads it made. The solver joins every
 * update, widening at selected unknowns. With a finite reachable system and terminating ascending
 * chains this reaches a post-fixpoint (the least fixpoint without widening). Values on exhaustion
 * describe partial progress only.
 */
export function solveFor<K, V>(eqs: Equations<K, V>, roots: readonly K[], budget: Budget): Solution<K, V> {
  const { lattice } = eqs;
  const values = new Map<K, V>();
  const readers = new Map<K, Set<K>>();
  const dependencies = new Map<K, Set<K>>();
  let pending = new Set<K>();
  let evaluations = 0;
  let rounds = 0;

  const demand = (key: K): V => {
    if (!values.has(key)) {
      values.set(key, lattice.bottom());
      readers.set(key, new Set());
      pending.add(key);
    }
    return values.get(key)!;
  };
  for (const root of roots) demand(root);

  while (pending.size) {
    if (evaluations >= budget.evaluations) return { status: 'exhausted', values, evaluations, rounds };
    const batch = pending;
    pending = new Set();
    rounds++;
    for (const key of batch) {
      if (evaluations >= budget.evaluations) return { status: 'exhausted', values, evaluations, rounds };
      // A reader already due in this batch sees the latest facts when its turn comes.
      pending.delete(key);
      for (const dependency of dependencies.get(key) ?? []) readers.get(dependency)!.delete(key);
      const reads = new Set<K>();
      dependencies.set(key, reads);
      const old = values.get(key)!;
      let next = lattice.join(
        old,
        eqs.rhs(key, other => {
          const value = demand(other);
          reads.add(other);
          readers.get(other)!.add(key);
          return value;
        }),
      );
      evaluations++;
      if (lattice.equal(old, next)) continue;
      if (eqs.widenAt?.(key) && lattice.widen) next = lattice.widen(old, next);
      values.set(key, next);
      for (const reader of readers.get(key)!) pending.add(reader);
    }
  }
  return { status: 'stable', values, evaluations, rounds };
}
