// Affine forms live in the standard library (IRWB-049-B): they are exact there, since the sums run in
// BigInt before the safe-integer check, which doubles alone cannot do, and one fusion decision now
// reads their dependence distances. They keep ordered terms so equivalent dimensions have the same
// artifact identity.
export { add, constant, plain, substitute, value, variable } from '../stdlib/affine/forms.js';
import type { Affine } from '../stdlib/affine/forms.js';
export type { Affine };
export type Extent =
  | { kind: 'dim'; dim: Affine }
  | { kind: 'blocks'; dim: Affine; rounding: 'ceil' | 'floor' }
  | { kind: 'tail'; dim: Affine; block: string };
export interface Axis {
  id: string;
  extent: Extent;
}
export type Op = '+' | '-' | '*' | '/' | 'neg' | 'exp' | 'log' | 'sqrt' | 'tanh' | 'max' | 'min';
export type Expr =
  | { kind: 'literal'; text: string }
  | { kind: 'shape'; name: string }
  | { kind: 'load'; name: string; indices: Affine[] }
  | { kind: 'op'; op: Op; args: Expr[] }
  | { kind: 'reduce'; op: 'sum' | 'max'; axes: Axis[]; body: Expr };
export interface Tensor {
  name: string;
  shape: Affine[];
}
export interface Statement extends Tensor {
  axes: Axis[];
  expr: Expr;
}
export interface Fn {
  name: string;
  params: Tensor[];
  statements: Statement[];
  result: string;
  shape: Affine[];
}
export interface Module {
  functions: Fn[];
}
export const width = 4;
export function mapExpr(e: Expr, f: (e: Expr) => Expr): Expr {
  if (e.kind === 'op') e = { ...e, args: e.args.map(x => mapExpr(x, f)) };
  if (e.kind === 'reduce') e = { ...e, body: mapExpr(e.body, f) };
  return f(e);
}
export function visit(e: Expr, f: (e: Expr) => void) {
  f(e);
  if (e.kind === 'op') e.args.forEach(x => visit(x, f));
  if (e.kind === 'reduce') visit(e.body, f);
}

export function selectFunction(module: Module, name: string): Fn {
  const fn = module.functions.find(f => f.name === name);
  if (!fn) throw Error('Unknown function ' + name);
  return fn;
}
