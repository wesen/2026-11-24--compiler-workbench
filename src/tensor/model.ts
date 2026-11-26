import type { Artifact } from '../framework/core/types.js';

export interface Location {
  readonly line: number;
  readonly col: number;
}

export function sourceError(at: Location, message: string): never {
  throw new Error(`${at.line}:${at.col}: ${message}`);
}

export interface Term {
  readonly name: string;
  readonly coefficient: number;
}

export interface Affine {
  readonly constant: number;
  readonly terms: readonly Term[];
}

export const constant = (value: number): Affine => ({ constant: value, terms: [] });
export const variable = (name: string): Affine => ({ constant: 0, terms: [{ name, coefficient: 1 }] });

export function add(left: Affine, right: Affine, scale = 1): Affine {
  const coefficients = new Map(left.terms.map(t => [t.name, BigInt(t.coefficient)]));
  const factor = BigInt(scale);
  for (const { name, coefficient } of right.terms)
    coefficients.set(name, (coefficients.get(name) ?? 0n) + factor * BigInt(coefficient));
  const terms = [...coefficients]
    .filter(([, coefficient]) => coefficient !== 0n)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, coefficient]) => ({ name, coefficient: safeInteger(coefficient) }));
  return { constant: safeInteger(BigInt(left.constant) + factor * BigInt(right.constant)), terms };
}

export const equalAffine = (a: Affine, b: Affine): boolean =>
  a.constant === b.constant &&
  a.terms.length === b.terms.length &&
  a.terms.every((term, i) => term.name === b.terms[i].name && term.coefficient === b.terms[i].coefficient);

export const equalShape = (a: readonly Affine[], b: readonly Affine[]): boolean =>
  a.length === b.length && a.every((axis, i) => equalAffine(axis, b[i]));

export class AffineRangeError extends Error {}

export function safeInteger(value: bigint): number {
  const integer = Number(value);
  if (!Number.isSafeInteger(integer))
    throw new AffineRangeError('affine integer is outside the safe integer range');
  return integer;
}

export function affineValue(affine: Affine, values: ReadonlyMap<string, number>): bigint {
  let value = BigInt(affine.constant);
  for (const term of affine.terms) {
    const binding = values.get(term.name);
    if (binding === undefined) throw new Error(`unbound affine name '${term.name}'`);
    value += BigInt(term.coefficient) * BigInt(binding);
  }
  return value;
}

export class InvalidExtent extends Error {}

export function dimensions(axes: readonly Affine[], shapes: ReadonlyMap<string, number>): number[] {
  return axes.map(axis => {
    const value = affineValue(axis, shapes);
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new InvalidExtent('tensor or loop extent is outside the nonnegative safe integer range');
    const size = Number(value);
    return size;
  });
}

export interface Binder {
  readonly id: string;
  readonly extent: Affine;
}

export type BinaryOp = '+' | '-' | '*' | '/';
export type Intrinsic = 'exp' | 'log' | 'sqrt' | 'tanh' | 'max' | 'min';
export type Expression =
  | { readonly kind: 'literal'; readonly spelling: string }
  | { readonly kind: 'shape'; readonly name: string }
  | { readonly kind: 'read'; readonly tensor: string; readonly indices: readonly Affine[] }
  | { readonly kind: 'negate'; readonly operand: Expression }
  | { readonly kind: 'binary'; readonly op: BinaryOp; readonly left: Expression; readonly right: Expression }
  | { readonly kind: 'call'; readonly op: Intrinsic; readonly args: readonly Expression[] }
  | {
      readonly kind: 'reduce';
      readonly op: 'sum' | 'max';
      readonly indices: readonly Binder[];
      readonly body: Expression;
    }
  | {
      readonly kind: 'blocked-sum';
      readonly index: Binder;
      readonly blockSize: number;
      readonly body: Expression;
    };

export interface TensorParameter {
  readonly name: string;
  readonly shape: readonly Affine[];
}

export interface Statement {
  readonly name: string;
  readonly order: number;
  readonly indices: readonly Binder[];
  readonly body: Expression;
}

export interface ShapeWitness {
  readonly name: string;
  readonly parameter: number;
  readonly axis: number;
}

export interface TensorFunction {
  readonly name: string;
  readonly parameters: readonly TensorParameter[];
  readonly witnesses: readonly ShapeWitness[];
  readonly result: readonly Affine[];
  readonly statements: readonly Statement[];
  readonly returns: string;
}

export interface TensorModule {
  readonly functions: readonly TensorFunction[];
}

export interface TixProgram {
  readonly origin: Artifact<TensorModule>;
  readonly artifact: Artifact<TensorModule>;
}

export const BLOCK_SIZE = 4;

export function children(expr: Expression): readonly Expression[] {
  switch (expr.kind) {
    case 'negate':
      return [expr.operand];
    case 'binary':
      return [expr.left, expr.right];
    case 'call':
      return expr.args;
    case 'reduce':
    case 'blocked-sum':
      return [expr.body];
    default:
      return [];
  }
}

export function mapChildren(expr: Expression, map: (child: Expression) => Expression): Expression {
  switch (expr.kind) {
    case 'negate':
      return { ...expr, operand: map(expr.operand) };
    case 'binary':
      return { ...expr, left: map(expr.left), right: map(expr.right) };
    case 'call':
      return { ...expr, args: expr.args.map(map) };
    case 'reduce':
    case 'blocked-sum':
      return { ...expr, body: map(expr.body) };
    default:
      return expr;
  }
}
