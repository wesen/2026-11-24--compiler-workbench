export interface Affine {
  readonly constant: string;
  readonly terms: readonly (readonly [symbol: string, coefficient: string])[];
}

export const constant = (n: bigint): Affine => ({ constant: String(n), terms: [] });
export const variable = (id: string): Affine => ({ constant: '0', terms: [[id, '1']] });

export function add(a: Affine, b: Affine): Affine {
  const terms = new Map(a.terms.map(([id, n]) => [id, BigInt(n)]));
  for (const [id, n] of b.terms) terms.set(id, (terms.get(id) ?? 0n) + BigInt(n));
  return {
    constant: String(BigInt(a.constant) + BigInt(b.constant)),
    terms: [...terms.keys()].sort().flatMap(id => {
      const n = terms.get(id)!;
      return n === 0n ? [] : [[id, String(n)] as const];
    }),
  };
}

export function scale(a: Affine, n: bigint): Affine {
  return {
    constant: String(BigInt(a.constant) * n),
    terms: n === 0n ? [] : a.terms.map(([id, k]) => [id, String(BigInt(k) * n)]),
  };
}

export function substitute(a: Affine, lookup: (id: string) => Affine): Affine {
  return a.terms.reduce(
    (acc, [id, n]) => add(acc, scale(lookup(id), BigInt(n))),
    constant(BigInt(a.constant)),
  );
}

export function value(a: Affine, lookup: (id: string) => bigint): bigint {
  return a.terms.reduce((acc, [id, n]) => acc + lookup(id) * BigInt(n), BigInt(a.constant));
}

export const equal = (a: Affine, b: Affine) =>
  a.constant === b.constant &&
  a.terms.length === b.terms.length &&
  a.terms.every(([id, n], i) => id === b.terms[i][0] && n === b.terms[i][1]);

/** Sufficient proof of strict negativity over nonnegative shape-name bindings. */
export const negative = (a: Affine) => BigInt(a.constant) < 0n && a.terms.every(([, n]) => BigInt(n) < 0n);

/** Fraction-free row elimination; the optional right-hand side is the actual extent minus the constant. */
export function echelon(names: readonly string[], dimensions: readonly Affine[], actual?: readonly number[]) {
  const width = names.length;
  const rows = dimensions.map((dim, i) => {
    const terms = new Map(dim.terms);
    const row = names.map(n => BigInt(terms.get(n) ?? '0'));
    if (actual) row.push(BigInt(actual[i]) - BigInt(dim.constant));
    return row;
  });
  for (let col = 0; col < width; col++) {
    const pivot = rows.findIndex((row, i) => i >= col && row[col] !== 0n);
    if (pivot < 0) return undefined;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    for (let i = col + 1; i < rows.length; i++) {
      const n = rows[i][col];
      if (n === 0n) continue;
      for (let j = col; j < rows[i].length; j++) rows[i][j] = rows[col][col] * rows[i][j] - n * rows[col][j];
    }
  }
  return rows;
}

export function solve(names: readonly string[], dimensions: readonly Affine[], actual: readonly number[]) {
  const rows = echelon(names, dimensions, actual);
  const width = names.length;
  if (!rows || rows.slice(width).some(row => row[width] !== 0n)) return undefined;
  const solution: bigint[] = [];
  for (let i = width - 1; i >= 0; i--) {
    let n = rows[i][width];
    for (let j = i + 1; j < width; j++) n -= rows[i][j] * solution[j];
    if (n % rows[i][i] !== 0n) return undefined;
    solution[i] = n / rows[i][i];
    if (solution[i] < 0n) return undefined;
  }
  return new Map(names.map((id, i) => [id, solution[i]]));
}
