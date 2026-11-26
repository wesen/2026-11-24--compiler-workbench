import type { Artifact } from '../framework/core/types.js';

export interface Loc {
  readonly line: number;
  readonly col: number;
}

export interface Named {
  readonly name: string;
  readonly at: Loc;
}

/** Normalized affine form. Keys are shape names or resolved index IDs, never both. */
export interface Affine {
  readonly c: number;
  readonly terms: readonly (readonly [string, number])[];
}

export interface Axis extends Named {
  readonly id: string;
  readonly extent: Affine;
}

export type Binary = '+' | '-' | '*' | '/';
export type Intrinsic = 'exp' | 'log' | 'sqrt' | 'tanh' | 'max' | 'min';
export type Expr<B = Axis, S = Affine> = { readonly id: string; readonly at: Loc } & (
  | { readonly op: 'literal'; readonly text: string }
  | { readonly op: 'shape'; readonly name: string }
  | { readonly op: 'load'; readonly tensor: string; readonly subs: readonly S[] }
  | { readonly op: 'neg'; readonly arg: Expr<B, S> }
  | { readonly op: Binary; readonly left: Expr<B, S>; readonly right: Expr<B, S> }
  | { readonly op: 'call'; readonly fn: Intrinsic; readonly args: readonly Expr<B, S>[] }
  | { readonly op: 'sum' | 'max'; readonly axes: readonly B[]; readonly body: Expr<B, S> }
  | { readonly op: 'blockedSum'; readonly axis: B; readonly blockSize: number; readonly body: Expr<B, S> }
);

export interface Param extends Named {
  readonly id: string;
  readonly shape: readonly Affine[];
}
export interface Statement extends Param {
  readonly axes: readonly Axis[];
  readonly expr: Expr;
}
export interface TensorFn extends Named {
  readonly id: string;
  readonly shapes: readonly string[];
  readonly params: readonly Param[];
  readonly resultShape: readonly Affine[];
  readonly statements: readonly Statement[];
  readonly result: string;
}
export interface TensorModule {
  readonly functions: readonly TensorFn[];
}
export type TixProgram = Artifact<TensorModule>;

export const fail = (at: Loc, message: string): never => {
  throw new Error(`${at.line}:${at.col}: ${message}`);
};

export class AffineRangeError extends Error {
  constructor(at: Loc) {
    super(`${at.line}:${at.col}: affine arithmetic exceeds the safe-integer range`);
  }
}

export function integer(n: number, at: Loc): number {
  if (!Number.isSafeInteger(n)) throw new AffineRangeError(at);
  return n === 0 ? 0 : n;
}

export const constant = (c: number): Affine => ({ c, terms: [] });
export const variable = (name: string): Affine => ({ c: 0, terms: [[name, 1]] });

export function plus(a: Affine, b: Affine, at: Loc): Affine {
  const terms = new Map(a.terms);
  for (const [key, v] of b.terms) terms.set(key, integer((terms.get(key) ?? 0) + v, at));
  return {
    c: integer(a.c + b.c, at),
    terms: [...terms].filter(([, n]) => n !== 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  };
}

export function scale(a: Affine, factor: number, at: Loc): Affine {
  return factor === 0
    ? constant(0)
    : { c: integer(a.c * factor, at), terms: a.terms.map(([key, n]) => [key, integer(n * factor, at)]) };
}

export const minus = (a: Affine, b: Affine, at: Loc): Affine => plus(a, scale(b, -1, at), at);

export function substitute(a: Affine, value: (name: string) => Affine, at: Loc): Affine {
  return a.terms.reduce((res, [name, n]) => plus(res, scale(value(name), n, at), at), constant(a.c));
}

export function evalAffine(a: Affine, values: ReadonlyMap<string, number>, at: Loc): number {
  return a.terms.reduce((res, [key, n]) => integer(res + integer(n * values.get(key)!, at), at), a.c);
}

export function equalAffine(a: Affine, b: Affine): boolean {
  return (
    a.c === b.c &&
    a.terms.length === b.terms.length &&
    a.terms.every(([k, n], i) => {
      return k === b.terms[i][0] && n === b.terms[i][1];
    })
  );
}

export function children<B, S>(expr: Expr<B, S>): readonly Expr<B, S>[] {
  switch (expr.op) {
    case 'neg':
      return [expr.arg];
    case '+':
    case '-':
    case '*':
    case '/':
      return [expr.left, expr.right];
    case 'sum':
    case 'max':
    case 'blockedSum':
      return [expr.body];
    case 'call':
      return expr.args;
    default:
      return [];
  }
}

export function mapChildren<B, S>(expr: Expr<B, S>, map: (child: Expr<B, S>) => Expr<B, S>): Expr<B, S> {
  switch (expr.op) {
    case 'neg':
      return { ...expr, arg: map(expr.arg) };
    case '+':
    case '-':
    case '*':
    case '/':
      return { ...expr, left: map(expr.left), right: map(expr.right) };
    case 'sum':
    case 'max':
    case 'blockedSum':
      return { ...expr, body: map(expr.body) };
    case 'call':
      return { ...expr, args: expr.args.map(map) };
    default:
      return expr;
  }
}

export function* walk(expr: Expr): Iterable<Expr> {
  yield expr;
  for (const child of children(expr)) yield* walk(child);
}
