// Affine maps of shape names (extents) or lexical binder IDs (subscripts).
export interface Aff {
  c: number;
  terms: [string, number][];
}
export const constant = (c: number): Aff => ({ c, terms: [] });
export const variable = (k: string): Aff => ({ c: 0, terms: [[k, 1]] });
export function add(a: Aff, b: Aff, factor = 1): Aff {
  const t = new Map(a.terms);
  for (const [k, n] of b.terms) t.set(k, (t.get(k) ?? 0) + n * factor);
  return {
    c: a.c + b.c * factor,
    terms: [...t].filter(([, n]) => n !== 0).sort(([x], [y]) => (x < y ? -1 : 1)),
  };
}
export const same = (a: Aff, b: Aff) =>
  a.c === b.c &&
  a.terms.length === b.terms.length &&
  a.terms.every(([k, v], i) => k === b.terms[i][0] && v === b.terms[i][1]);
export const plain = (a: Aff) =>
  a.c === 0 && a.terms.length === 1 && a.terms[0][1] === 1 ? a.terms[0][0] : undefined;
export const evalAff = (a: Aff, env: Map<string, number>) =>
  a.terms.reduce((v, [k, n]) => v + n * env.get(k)!, a.c);
export interface Node {
  id: string;
  at: string;
}
export interface Binder extends Node {
  name: string;
  dim: Aff;
  loop?: { kind: 'blocks'; round: 'ceil' | 'floor' } | { kind: 'lanes'; block: string };
}
export interface Def extends Node {
  name: string;
  shape: Aff[];
}
export interface Stmt extends Def {
  axes: Binder[];
  body: Expr;
}
export interface Fn extends Node {
  name: string;
  params: Def[];
  stmts: Stmt[];
  result: string;
  shape: Aff[];
}
export interface Program {
  functions: Fn[];
}
export type Expr = Node &
  (
    | { tag: 'literal'; text: string }
    | { tag: 'shape'; name: string }
    | { tag: 'load'; def: string; subs: Aff[] }
    | { tag: 'op'; op: string; args: Expr[] }
    | { tag: 'reduce'; op: 'sum' | 'max'; axes: Binder[]; body: Expr }
  );
export const arities = new Map(
  Object.entries({
    neg: 1,
    '+': 2,
    '-': 2,
    '*': 2,
    '/': 2,
    exp: 1,
    log: 1,
    sqrt: 1,
    tanh: 1,
    max: 2,
    min: 2,
  }),
);
export const width = 4;
export const fail = (at: string, message: string): never => {
  throw new Error(`${at}: ${message}`);
};
export function visit(e: Expr, fn: (e: Expr) => void) {
  fn(e);
  if (e.tag === 'op') e.args.forEach(a => visit(a, fn));
  if (e.tag === 'reduce') visit(e.body, fn);
}
export function symbols(f: Fn) {
  return [...new Set(f.params.flatMap(p => p.shape.flatMap(a => a.terms.map(([k]) => k))))].sort();
}
