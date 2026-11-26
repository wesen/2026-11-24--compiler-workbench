export const numericLiteral = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

/** Normalized integer affine forms, shared by shapes and indexed reads. */
export interface Affine {
  constant: number;
  terms: [string, number][];
}
export const constant = (n: number): Affine => ({ constant: n, terms: [] });
export const variable = (id: string): Affine => ({ constant: 0, terms: [[id, 1]] });
export function addScaled(a: Affine, b: Affine, scale = 1): Affine {
  const coefficients = new Map(a.terms);
  for (const [name, value] of b.terms) coefficients.set(name, (coefficients.get(name) ?? 0) + scale * value);
  return {
    constant: a.constant + scale * b.constant,
    terms: [...coefficients].filter(([, n]) => n !== 0).sort(([a], [b]) => (a < b ? -1 : 1)),
  };
}
export function substitute(a: Affine, lookup: (id: string) => Affine): Affine {
  return a.terms.reduce((sum, [id, n]) => addScaled(sum, lookup(id), n), constant(a.constant));
}
export function valueOf(a: Affine, bindings: ReadonlyMap<string, number>): number {
  let result = a.constant;
  for (const [id, n] of a.terms) result += n * bindings.get(id)!;
  return result;
}
export function singleName(a: Affine): string | undefined {
  if (a.constant === 0 && a.terms.length === 1 && a.terms[0][1] === 1) return a.terms[0][0];
}
export const equalForm = (a: Affine, b: Affine) =>
  a.constant === b.constant &&
  a.terms.length === b.terms.length &&
  a.terms.every(([id, n], i) => id === b.terms[i][0] && n === b.terms[i][1]);
export const equalShape = (a: Affine[], b: Affine[]) =>
  a.length === b.length && a.every((d, i) => equalForm(d, b[i]));

export interface Axis {
  id: string;
  extent: Affine;
}
export type Range = Axis &
  ({ kind: 'full' } | { kind: 'blocks'; size: number } | { kind: 'within'; size: number; outer: string });
export type Binary = '+' | '-' | '*' | '/';
export type UnaryCall = 'exp' | 'log' | 'sqrt' | 'tanh';
export type Expr =
  | { kind: 'literal'; text: string }
  | { kind: 'shape'; name: string }
  | { kind: 'read'; tensor: string; indices: Affine[] }
  | { kind: 'neg' | UnaryCall; arg: Expr }
  | { kind: 'binary'; op: Binary | 'max' | 'min'; left: Expr; right: Expr }
  | { kind: 'fold'; op: 'sum' | 'max'; axes: Range[]; body: Expr };
export interface TensorDecl {
  name: string;
  shape: Affine[];
}
export interface Definition extends TensorDecl {
  axes: Axis[];
  body: Expr;
}
export interface TensorFn {
  name: string;
  symbols: string[];
  params: TensorDecl[];
  definitions: Definition[];
  result: string;
  resultShape: Affine[];
}
export interface TensorModule {
  functions: TensorFn[];
}

export function children(e: Expr): Expr[] {
  if (e.kind === 'binary') return [e.left, e.right];
  if (e.kind === 'fold') return [e.body];
  return 'arg' in e ? [e.arg] : [];
}
export function walk(e: Expr, visit: (expr: Expr) => void): void {
  visit(e);
  for (const child of children(e)) walk(child, visit);
}
/** Bottom-up so inserted subtrees are not themselves rewritten on this visit. */
export function rewrite(e: Expr, replace: (expr: Expr) => Expr): Expr {
  if (e.kind === 'binary') e = { ...e, left: rewrite(e.left, replace), right: rewrite(e.right, replace) };
  else if (e.kind === 'fold') e = { ...e, body: rewrite(e.body, replace) };
  else if ('arg' in e) e = { ...e, arg: rewrite(e.arg, replace) };
  return replace(e);
}
