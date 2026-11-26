import type { Affine } from './affine.js';

export interface Span {
  readonly line: number;
  readonly col: number;
}

export function errorAt(span: Span, message: string): never {
  throw new Error(`${span.line}:${span.col}: ${message}`);
}

export const operators = ['+', '-', '*', '/'] as const;
export const builtins = ['exp', 'log', 'sqrt', 'tanh', 'max', 'min'] as const;
export type Op = (typeof operators)[number];
export type Builtin = (typeof builtins)[number];
export type Shape = readonly Affine[];
export const numberPattern = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
export const namePattern = /^[A-Za-z_][A-Za-z_0-9]*/;

export interface Load {
  readonly tensor: string;
  readonly subscripts: readonly Affine[];
}

export type Range =
  | { readonly kind: 'full' }
  | { readonly kind: 'blocks'; readonly size: number }
  | { readonly kind: 'within'; readonly size: number; readonly block: string };

export interface Axis {
  readonly id: string;
  /** Logical full extent; the range may partition it into blocks. */
  readonly extent: Affine;
  readonly range: Range;
}

export type Expr<L = Load, A = Axis> = { readonly at: Span } & (
  | { readonly tag: 'literal' | 'shape'; readonly text: string }
  | { readonly tag: 'load'; readonly load: L }
  | { readonly tag: 'neg'; readonly body: Expr<L, A> }
  | { readonly tag: 'binary'; readonly op: Op; readonly left: Expr<L, A>; readonly right: Expr<L, A> }
  | { readonly tag: 'call'; readonly op: Builtin; readonly args: readonly Expr<L, A>[] }
  | {
      readonly tag: 'fold';
      readonly op: 'sum' | 'max';
      readonly axes: readonly A[];
      readonly body: Expr<L, A>;
    }
);

export interface Param {
  readonly name: string;
  readonly at: Span;
  readonly shape: Shape;
}
export interface Stmt extends Param {
  readonly axes: readonly Axis[];
  readonly expr: Expr;
}
export interface TensorFn {
  readonly name: string;
  readonly at: Span;
  readonly params: readonly Param[];
  readonly result: Shape;
  readonly statements: readonly Stmt[];
  readonly return: string;
}
export interface TensorIR {
  readonly functions: readonly TensorFn[];
}

export function children<L, A>(expr: Expr<L, A>): readonly Expr<L, A>[] {
  switch (expr.tag) {
    case 'neg':
    case 'fold':
      return [expr.body];
    case 'binary':
      return [expr.left, expr.right];
    case 'call':
      return expr.args;
    default:
      return [];
  }
}

export function* expressions<L, A>(expr: Expr<L, A>): Iterable<Expr<L, A>> {
  yield expr;
  for (const child of children(expr)) yield* expressions(child);
}

/** Postorder mapping. Keep the original scalar operation order unchanged. */
export function mapExpr(expr: Expr, map: (e: Expr) => Expr): Expr {
  const visit = (e: Expr) => mapExpr(e, map);
  switch (expr.tag) {
    case 'neg':
    case 'fold':
      return map({ ...expr, body: visit(expr.body) });
    case 'binary':
      return map({ ...expr, left: visit(expr.left), right: visit(expr.right) });
    case 'call':
      return map({ ...expr, args: expr.args.map(visit) });
    default:
      return map(expr);
  }
}
