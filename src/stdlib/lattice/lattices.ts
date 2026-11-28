/**
 * Lattices for monotone dataflow problems: the second group of primitives in the standard library
 * (IRWB-039 phase 2c, IRWB-048-B), moved out of `framework/dataflow/lattices.ts` without being
 * rewritten. A lattice gives a bottom element, a join (least upper bound), equality, and a finite-JSON
 * encoding. The set, flat and map lattices have finite height: a chain of joins reaches its limit in
 * finitely many steps. The interval lattice has infinite height, so a solver must use its `widen`.
 *
 * What "the same lattice" means here, since the clients disagree on names: a lattice is the element
 * set, the order (through `join` and `equal`) and the height, not the spelling of the elements. The
 * flat lattice is three levels — `BOT` (no value yet; Wegman and Zadeck's ⊤, "not yet seen to
 * execute"), any single value, `TOP` (`varies`; their ⊥, "overdefined") — with elements compared as
 * JSON, which is why `T` is JSON: two values that encode alike are the same constant.
 *
 * `Json` is declared here rather than imported from `framework/core/types.ts` because the library
 * imports nothing outside `src/stdlib/` (`tests/stdlib/layering.test.mjs` enforces the layering). It is
 * the same type as the framework's, so `Lattice<V>` from here is the `Lattice<V>` the dataflow layer
 * passed around before the move.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

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

/**
 * Integer intervals within i32. Infinite height in principle (as in CW), so solving requires widening.
 * `thresholds` (all within [min, max]) switches the widening to widening up-to (Cousot/Halbwachs): a moved
 * bound jumps to the nearest threshold instead of the extreme, which keeps precision near small values;
 * the set is finite, so widening sequences still terminate, and a bound already past every threshold still
 * jumps to the extreme in one step.
 */
export function intervalLattice(
  min = I32_MIN,
  max = I32_MAX,
  thresholds: readonly number[] = [],
): Lattice<Interval> & {
  readonly top: readonly [number, number];
  widen(old: Interval, next: Interval): Interval;
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
    /** Standard widening: a bound that moved jumps to the nearest threshold (the extreme without thresholds). */
    widen(old, next) {
      if (!old) return next;
      if (!next) return old;
      const down = (n: number) => {
        let best = min;
        for (const t of thresholds) if (t <= n && t > best) best = t;
        return best;
      };
      const up = (n: number) => {
        let best = max;
        for (const t of thresholds) if (t >= n && t < best) best = t;
        return best;
      };
      return [next[0] < old[0] ? down(next[0]) : old[0], next[1] > old[1] ? up(next[1]) : old[1]];
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
