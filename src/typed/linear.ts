/**
 * Linear forms over i32 values, exact modulo 2^32 (IRWB-037-D).
 *
 * A value tree is a linear form when it is built from constants, reads of a local, `add` and `sub`, and products
 * by a constant or shifts by a constant (`shl`). Anything else — a load, a call, a division, a comparison, a
 * product of two non-constants — is not, and the caller gets `null`.
 *
 * A read is resolved by the caller's `reader`, which decides what the read *stands for* at its site: either
 * another value with the site where that value is computed (a local with exactly one reaching definition is that
 * definition's value there), or a name. Two forms over the same names compute the same value whenever both sites
 * run, which is what a proof that compares two sites needs.
 *
 * `bce` (`bounds-check elimination`) is the user here; `bcm` keeps its own, in-block version of the same shape,
 * because its names are definitions earlier in one block rather than reaching definitions. Unifying the two is
 * left to a later stage.
 */
import type { Store, ValueRec } from './model.js';

export interface LinearForm {
  /** name -> coefficient, with zero coefficients dropped. */
  readonly coeffs: ReadonlyMap<string, number>;
  /** The constant term, as an i32. */
  readonly k: number;
}

export interface LinearReader {
  /**
   * What a read of `local` at `site` stands for: the value it is computed from there, the name of the value, or
   * `null` when the read cannot be named (so the tree is not usable as a form).
   */
  read(
    site: string,
    local: number,
  ): { readonly value: string; readonly site: string } | { readonly name: string } | null;
}

const add = (a: LinearForm, b: LinearForm, sign: 1 | -1): LinearForm => {
  const coeffs = new Map(a.coeffs);
  for (const [x, c] of b.coeffs) {
    const v = ((coeffs.get(x) ?? 0) + sign * c) | 0;
    if (v === 0) coeffs.delete(x);
    else coeffs.set(x, v);
  }
  return { coeffs, k: (a.k + sign * b.k) | 0 };
};

const scale = (a: LinearForm, c: number): LinearForm => ({
  coeffs: new Map([...a.coeffs].map(([x, y]) => [x, Math.imul(y, c)])),
  k: Math.imul(a.k, c),
});

/** The linear form of `id` at `site`, or `null`. `seen` stops a read that expands back into itself. */
export function linearForm(
  st: Store,
  reader: LinearReader,
  site: string,
  id: string,
  seen: Set<string> = new Set(),
  depth = 0,
): LinearForm | null {
  if (depth > 64) return null;
  const v = st.get(id) as ValueRec;
  const sub = (x: string) => linearForm(st, reader, site, x, seen, depth + 1);
  const lit = (x: string): number | null => {
    const w = st.get(x) as ValueRec;
    return w.op === 'const' && !w.type ? (w.imm as number) : null;
  };
  switch (v.op) {
    case 'const':
      return v.type ? null : { coeffs: new Map(), k: v.imm as number };
    case 'get': {
      const key = `${site}\u0000${v.imm}`;
      const r = reader.read(site, v.imm as number);
      if (!r) return null;
      if ('name' in r) return { coeffs: new Map([[r.name, 1]]), k: 0 };
      if (seen.has(key)) return null;
      seen.add(key);
      const inner = linearForm(st, reader, r.site, r.value, seen, depth + 1);
      seen.delete(key);
      return inner;
    }
    case 'add':
    case 'sub': {
      const a = sub(v.args[0]),
        b = sub(v.args[1]);
      return a && b ? add(a, b, v.op === 'add' ? 1 : -1) : null;
    }
    case 'mul': {
      const k = lit(v.args[1]),
        j = lit(v.args[0]);
      if (k !== null) {
        const a = sub(v.args[0]);
        return a ? scale(a, k) : null;
      }
      if (j !== null) {
        const b = sub(v.args[1]);
        return b ? scale(b, j) : null;
      }
      return null;
    }
    case 'shl': {
      const k = lit(v.args[1]);
      const a = k === null ? null : sub(v.args[0]);
      return a && k !== null && k >= 0 && k < 31 ? scale(a, 2 ** k) : null;
    }
    default:
      return null;
  }
}

/**
 * `b - a` when the two forms have exactly the same names, which makes the difference a constant: the second
 * value is the first one plus this number, modulo 2^32. `null` otherwise.
 */
export function formDifference(b: LinearForm, a: LinearForm): number | null {
  if (b.coeffs.size !== a.coeffs.size) return null;
  for (const [x, c] of a.coeffs) if (b.coeffs.get(x) !== c) return null;
  return (b.k - a.k) | 0;
}
