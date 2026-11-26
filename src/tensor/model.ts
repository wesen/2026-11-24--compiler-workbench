export type Affine = { constant: number; terms: [string, number][] };
export type Axis = { id: string; extent: Affine };
export type Unary = '-' | 'exp' | 'log' | 'sqrt' | 'tanh';
export type Binary = '+' | '-' | '*' | '/' | 'min' | 'max';
export type Expr = { at: string } & (
  | { kind: 'literal'; value: string }
  | { kind: 'shape'; name: string }
  | { kind: 'load'; tensor: string; indices: Affine[] }
  | { kind: 'unary'; op: Unary; arg: Expr }
  | { kind: 'binary'; op: Binary; left: Expr; right: Expr }
  | { kind: 'reduce'; op: 'sum' | 'max'; axes: Axis[]; body: Expr }
  | { kind: 'blocked'; size: number; axes: [Axis]; body: Expr }
);
export type Param = { name: string; shape: Affine[] };
export type Statement = { name: string; axes: Axis[]; expr: Expr };
export type Fn = { name: string; params: Param[]; statements: Statement[]; result: string; shape: Affine[] };
export type Module = { functions: Fn[] };
export type Bindings = Map<string, number>;

export const constant = (n: number): Affine => ({ constant: n, terms: [] });
export const variable = (name: string): Affine => ({ constant: 0, terms: [[name, 1]] });
export function plain(a: Affine): string | undefined {
  if (a.constant === 0 && a.terms.length === 1 && a.terms[0][1] === 1) return a.terms[0][0];
}
export function scale(a: Affine, k: number): Affine {
  return { constant: a.constant * k, terms: k === 0 ? [] : a.terms.map(([n, v]) => [n, v * k]) };
}
export function add(a: Affine, b: Affine): Affine {
  const terms = new Map(a.terms);
  for (const [name, v] of b.terms) terms.set(name, (terms.get(name) ?? 0) + v);
  return {
    constant: a.constant + b.constant,
    terms: [...terms].filter(([, v]) => v !== 0).sort(([a], [b]) => (a < b ? -1 : 1)),
  };
}
export function substitute(a: Affine, bindings: Map<string, Affine>): Affine {
  return a.terms.reduce(
    (acc, [n, k]) => add(acc, scale(bindings.get(n) ?? variable(n), k)),
    constant(a.constant),
  );
}
export function same(a: Affine, b: Affine): boolean {
  return (
    a.constant === b.constant &&
    a.terms.length === b.terms.length &&
    a.terms.every(([n, k], i) => n === b.terms[i][0] && k === b.terms[i][1])
  );
}
export function sameShape(a: Affine[], b: Affine[]): boolean {
  return a.length === b.length && a.every((d, i) => same(d, b[i]));
}
export function value(a: Affine, vars: Bindings): number {
  return a.terms.reduce((sum, [n, k]) => sum + k * vars.get(n)!, a.constant);
}
export function symbols(fn: Fn): string[] {
  return [...new Set(fn.params.flatMap(p => p.shape.map(plain)).filter((n): n is string => n !== undefined))];
}
export function mapExpr(e: Expr, visit: (e: Expr) => Expr): Expr {
  switch (e.kind) {
    case 'unary':
      return visit({ ...e, arg: mapExpr(e.arg, visit) });
    case 'binary':
      return visit({ ...e, left: mapExpr(e.left, visit), right: mapExpr(e.right, visit) });
    case 'reduce':
    case 'blocked':
      return visit({ ...e, body: mapExpr(e.body, visit) });
    default:
      return visit(e);
  }
}
export function walk(e: Expr, visit: (e: Expr) => void): void {
  visit(e);
  switch (e.kind) {
    case 'unary':
      walk(e.arg, visit);
      break;
    case 'binary':
      walk(e.left, visit);
      walk(e.right, visit);
      break;
    case 'reduce':
    case 'blocked':
      walk(e.body, visit);
      break;
  }
}
// Endpoints of a subscript over a rectangular box are themselves affine in the shape symbols.
export function endpoints(index: Affine, axes: Map<string, Affine>): [Affine, Affine] {
  let lo = constant(index.constant),
    hi = lo;
  for (const [id, k] of index.terms) {
    const end = scale(add(axes.get(id)!, constant(-1)), k);
    if (k < 0) lo = add(lo, end);
    else hi = add(hi, end);
  }
  return [lo, hi];
}
export function fail(at: string, message: string): never {
  throw new Error(at + ' ' + message);
}
