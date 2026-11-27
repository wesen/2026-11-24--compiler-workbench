/**
 * IRWB-001 E4: lattices for monotone dataflow problems.
 *
 * A lattice gives a bottom element, a join (least upper bound), equality, and a finite-JSON encoding, so solved
 * facts can be persisted and compared by the v6 analysis manager. A lattice of infinite height (intervals) must be
 * solved with a widening operator; the solver refuses it otherwise.
 */
import type { Json } from '../core/types.js';

export interface Lattice<V> {
  readonly name: string;
  bottom(): V;
  join(a: V, b: V): V;
  equal(a: V, b: V): boolean;
  encode(value: V): Json;
  decode(json: Json): V;
  /** True when ascending chains can be infinite; such a lattice needs `widen`. */
  readonly infiniteHeight: boolean;
}

/** A finite set of numbers or strings, ordered by inclusion; bottom is the empty set. */
export function setLattice<T extends number | string>(): Lattice<ReadonlySet<T>> {
  return {
    name: 'set',
    infiniteHeight: false,
    bottom: () => new Set<T>(),
    join(a, b) {
      if (!b.size) return a;
      if (!a.size) return b;
      const out = new Set(a);
      for (const x of b) out.add(x);
      return out;
    },
    equal: (a, b) => a.size === b.size && [...a].every(x => b.has(x)),
    encode: v => [...v].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)) as Json,
    decode: j => new Set(j as T[]),
  };
}

export const TOP = 'varies';
export const BOT = 'unknown';
export type Flat<T> = typeof TOP | typeof BOT | { readonly value: T };

/** The flat lattice: unknown (bottom) < any single value < varies (top). */
export function flatLattice<T extends Json>(): Lattice<Flat<T>> {
  const same = (a: Flat<T>, b: Flat<T>) =>
    a === b ||
    (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a.value) === JSON.stringify(b.value));
  return {
    name: 'flat',
    infiniteHeight: false,
    bottom: () => BOT,
    join: (a, b) => (a === BOT ? b : b === BOT ? a : same(a, b) ? a : TOP),
    equal: same,
    encode: v => (typeof v === 'object' ? { value: v.value } : v),
    decode: j => j as Flat<T>,
  };
}

export const I32_MIN = -2147483648;
export const I32_MAX = 2147483647;
/** A closed integer interval [lo, hi] within i32, or null (bottom: no value reaches here). */
export type Interval = readonly [number, number] | null;

/** Integer intervals within i32. Infinite height in principle (as in CW), so solving requires widening. */
export function intervalLattice(
  min = I32_MIN,
  max = I32_MAX,
): Lattice<Interval> & {
  readonly top: readonly [number, number];
  widen(old: Interval, next: Interval, thresholds?: readonly number[]): Interval;
} {
  const top = [min, max] as const;
  return {
    name: 'interval',
    infiniteHeight: true,
    top,
    bottom: () => null,
    join: (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.max(a[1], b[1])]),
    equal: (a, b) => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1]),
    encode: v => (v ? [v[0], v[1]] : null),
    decode: j => (j === null ? null : [(j as number[])[0], (j as number[])[1]]),
    /** A moving bound jumps to the nearest enclosing threshold, or the domain extreme. */
    widen(old, next, thresholds = []) {
      if (!old) return next;
      if (!next) return old;
      let lower = min,
        upper = max;
      for (const t of thresholds) {
        if (t <= next[0]) lower = Math.max(lower, t);
        if (t >= next[1]) upper = Math.min(upper, t);
      }
      return [
        next[0] < old[0] ? lower : old[0],
        next[1] > old[1] ? upper : old[1],
      ];
    },
  };
}

/** A map from keys to an inner lattice; a missing key is bottom. Height is the inner lattice's. */
export function mapLattice<K extends string | number, V>(
  inner: Lattice<V>,
): Lattice<ReadonlyMap<K, V>> & { readonly inner: Lattice<V> } {
  const isBottom = (v: V) => inner.equal(v, inner.bottom());
  return {
    name: `map(${inner.name})`,
    inner,
    infiniteHeight: inner.infiniteHeight,
    bottom: () => new Map<K, V>(),
    join(a, b) {
      if (!b.size) return a;
      if (!a.size) return b;
      const out = new Map(a);
      for (const [k, v] of b) out.set(k, out.has(k) ? inner.join(out.get(k)!, v) : v);
      return out;
    },
    equal(a, b) {
      const keys = new Set([...a.keys(), ...b.keys()]);
      for (const k of keys) {
        const x = a.get(k) ?? inner.bottom(),
          y = b.get(k) ?? inner.bottom();
        if (!inner.equal(x, y)) return false;
      }
      return true;
    },
    encode(v) {
      const out: Record<string, Json> = {};
      for (const k of [...v.keys()].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)))
        if (!isBottom(v.get(k)!)) out[String(k)] = inner.encode(v.get(k)!);
      return out;
    },
    decode(j) {
      const out = new Map<K, V>();
      for (const [k, x] of Object.entries(j as Record<string, Json>))
        out.set((/^-?\d+$/.test(k) ? Number(k) : k) as K, inner.decode(x));
      return out;
    },
  };
}

export const lattice = {
  set: setLattice,
  flat: flatLattice,
  interval: intervalLattice,
  map: mapLattice,
  TOP,
  BOT,
};
