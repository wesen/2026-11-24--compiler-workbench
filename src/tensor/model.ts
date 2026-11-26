import type { Artifact } from '../framework/core/types.js';

export interface Location {
  readonly line: number;
  readonly col: number;
}

export function fail(at: Location, message: string): never {
  throw new Error(`${at.line}:${at.col}: ${message}`);
}

// Decimal strings keep exact affine arithmetic compatible with canonical v6 JSON.
export interface Affine {
  readonly constant: string;
  readonly terms: readonly (readonly [name: string, coefficient: string])[];
}

export function constant(n: bigint): Affine {
  return { constant: String(n), terms: [] };
}

export function variable(name: string): Affine {
  return { constant: '0', terms: [[name, '1']] };
}

export function scale(a: Affine, n: bigint): Affine {
  if (n === 0n) return constant(0n);
  return {
    constant: String(BigInt(a.constant) * n),
    terms: a.terms.map(([name, c]) => [name, String(BigInt(c) * n)]),
  };
}

export function add(a: Affine, b: Affine): Affine {
  const terms = new Map(a.terms.map(([name, n]) => [name, BigInt(n)]));
  for (const [name, n] of b.terms) terms.set(name, BigInt(n) + (terms.get(name) ?? 0n));
  return {
    constant: String(BigInt(a.constant) + BigInt(b.constant)),
    terms: [...terms.keys()].sort().flatMap(name => {
      const n = terms.get(name)!;
      return n === 0n ? [] : [[name, String(n)] as const];
    }),
  };
}

export function subtract(a: Affine, b: Affine): Affine {
  return add(a, scale(b, -1n));
}

export function sameAffine(a: Affine, b: Affine): boolean {
  return (
    a.constant === b.constant &&
    a.terms.length === b.terms.length &&
    a.terms.every(([name, n], i) => name === b.terms[i][0] && n === b.terms[i][1])
  );
}

export function evaluateAffine(a: Affine, resolve: (name: string) => bigint): bigint {
  let n = BigInt(a.constant);
  for (const [name, c] of a.terms) n += BigInt(c) * resolve(name);
  return n;
}

export function substituteAffine(a: Affine, resolve: (name: string) => Affine): Affine {
  let result = constant(BigInt(a.constant));
  for (const [name, n] of a.terms) result = add(result, scale(resolve(name), BigInt(n)));
  return result;
}

export type Unary = '-' | 'exp' | 'log' | 'sqrt' | 'tanh';
export type Binary = '+' | '-' | '*' | '/' | 'min' | 'max';

export type Expression<R, B> =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'shape'; readonly name: string; readonly at: Location }
  | ({ readonly kind: 'read' } & R)
  | { readonly kind: 'unary'; readonly op: Unary; readonly arg: Expression<R, B> }
  | {
      readonly kind: 'binary';
      readonly op: Binary;
      readonly left: Expression<R, B>;
      readonly right: Expression<R, B>;
    }
  | {
      readonly kind: 'reduce';
      readonly op: 'sum' | 'max';
      readonly binders: readonly B[];
      readonly body: Expression<R, B>;
      readonly block?: number;
    };

export interface Binder {
  readonly id: string;
  readonly extent: Affine;
}

export interface Read {
  readonly tensor: string;
  readonly coords: readonly Affine[];
  readonly at: Location;
}

export type Expr = Expression<Read, Binder>;

export interface Parameter {
  readonly name: string;
  readonly shape: readonly Affine[];
}

export interface Statement {
  readonly name: string;
  readonly binders: readonly Binder[];
  readonly body: Expr;
}

export interface TensorFunction {
  readonly name: string;
  readonly shapeNames: readonly string[];
  readonly params: readonly Parameter[];
  readonly resultShape: readonly Affine[];
  readonly statements: readonly Statement[];
  readonly result: string;
}

export interface TensorIR {
  readonly functions: readonly TensorFunction[];
}

export type TensorArtifact = Artifact<TensorIR>;

export function* expressions(expr: Expr): Generator<Expr> {
  yield expr;
  switch (expr.kind) {
    case 'unary':
      yield* expressions(expr.arg);
      break;
    case 'binary':
      yield* expressions(expr.left);
      yield* expressions(expr.right);
      break;
    case 'reduce':
      yield* expressions(expr.body);
      break;
  }
}
