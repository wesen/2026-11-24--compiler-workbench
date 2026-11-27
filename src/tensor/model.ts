// Affine forms use ordered terms so equivalent dimensions have the same artifact identity.
export interface Affine {
  constant: number;
  terms: [string, number][];
}
export const constant = (value: number): Affine => ({ constant: value, terms: [] });
export const variable = (name: string): Affine => ({ constant: 0, terms: [[name, 1]] });
export function add(a: Affine, b: Affine, scale = 1): Affine {
  const terms = new Map(a.terms);
  for (const [name, k] of b.terms) terms.set(name, (terms.get(name) ?? 0) + k * scale);
  const result = {
    constant: a.constant + b.constant * scale,
    terms: [...terms].filter(([, k]) => k !== 0).sort(([x], [y]) => (x < y ? -1 : 1)),
  };
  if (![result.constant, ...result.terms.map(([, k]) => k)].every(Number.isSafeInteger))
    throw Error('Affine integer overflow');
  return result;
}
export function substitute(a: Affine, bindings: Map<string, Affine>): Affine {
  return a.terms.reduce(
    (v, [name, k]) => add(v, bindings.get(name) ?? variable(name), k),
    constant(a.constant),
  );
}
export function value(a: Affine, env: ReadonlyMap<string, number>): number {
  return a.terms.reduce((v, [name, k]) => v + env.get(name)! * k, a.constant);
}
export function plain(a: Affine): string | undefined {
  return a.constant === 0 && a.terms.length === 1 && a.terms[0][1] === 1 ? a.terms[0][0] : undefined;
}
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
