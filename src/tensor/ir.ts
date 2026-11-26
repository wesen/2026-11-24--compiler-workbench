/**
 * The Tix IR (IRWB-020): a checked tensor program with every inferred fact explicit.
 *
 * A function is an ordered list of statements. A statement is a perfect loop nest over its `indices` (the tensor's
 * shape is their extents) around an expression tree; a reduction in the tree is an inner loop nest with one
 * accumulator, its indices in loop order. Extents are affine in the shape names when the checker produces them;
 * `min` and `ceildiv`, and extents that mention an enclosing reduction index, exist for blocked loops (`split-sum`).
 *
 * The framework sees statements, not expression nodes: entities are functions, parameters and statements, and a
 * statement's expression is attribute data. Nothing in this stage matches patterns inside expressions.
 */
import { defineIR } from '../framework/contracts/definitions.js';
import { defineAdapter } from '../framework/ir/adapters.js';
import type { IREntity, IRRelation } from '../framework/ir/types.js';

/** c + sum of coef * name. In dims: shape names. In subscripts: index names. In extents: both. */
export interface Aff {
  readonly c: number;
  readonly terms: Readonly<Record<string, number>>;
}
export type Extent =
  | { readonly k: 'aff'; readonly aff: Aff }
  | { readonly k: 'min'; readonly a: Extent; readonly b: Extent }
  | { readonly k: 'ceildiv'; readonly a: Extent; readonly by: number };
export interface Index {
  readonly name: string;
  readonly extent: Extent;
}
export type CallName = 'exp' | 'log' | 'sqrt' | 'tanh' | 'max' | 'min';
export type BinOp = '+' | '-' | '*' | '/';
export type Expr =
  | { readonly k: 'lit'; readonly value: number }
  | { readonly k: 'shape'; readonly name: string }
  | { readonly k: 'ref'; readonly tensor: string; readonly at: readonly Aff[] }
  | { readonly k: 'neg'; readonly a: Expr }
  | { readonly k: 'bin'; readonly op: BinOp; readonly a: Expr; readonly b: Expr }
  | { readonly k: 'call'; readonly fn: CallName; readonly args: readonly Expr[] }
  | {
      readonly k: 'reduce';
      readonly op: 'sum' | 'max';
      readonly indices: readonly Index[];
      readonly body: Expr;
    };
export interface Param {
  readonly name: string;
  readonly dims: readonly Aff[];
}
export interface Stmt {
  readonly name: string;
  readonly indices: readonly Index[];
  readonly expr: Expr;
}
export interface Fn {
  readonly name: string;
  /** Shape names, sorted. */
  readonly shapes: readonly string[];
  readonly params: readonly Param[];
  /** In source order; a statement reads only parameters and earlier statements. */
  readonly stmts: readonly Stmt[];
  /** The tensor (parameter or statement) the function returns. */
  readonly result: string;
}
export interface TixIR {
  readonly fns: Readonly<Record<string, Fn>>;
}

// ---------- affine forms ----------
export function aff(c: number, terms: Readonly<Record<string, number>> = {}): Aff {
  const out: Record<string, number> = {};
  for (const name of Object.keys(terms).sort()) if (terms[name] !== 0) out[name] = terms[name];
  return { c, terms: out };
}
export const affName = (name: string): Aff => ({ c: 0, terms: { [name]: 1 } });
export function affAdd(a: Aff, b: Aff, scale = 1): Aff {
  const terms: Record<string, number> = { ...a.terms };
  for (const [n, k] of Object.entries(b.terms)) terms[n] = (terms[n] ?? 0) + scale * k;
  return aff(a.c + scale * b.c, terms);
}
export function affScale(a: Aff, k: number): Aff {
  return aff(a.c * k, Object.fromEntries(Object.entries(a.terms).map(([n, c]) => [n, c * k])));
}
export function affEqual(a: Aff, b: Aff): boolean {
  const d = affAdd(a, b, -1);
  return d.c === 0 && Object.keys(d.terms).length === 0;
}
/** Replace each name that `map` knows by its affine form; other names stay. */
export function affSubst(a: Aff, map: Readonly<Record<string, Aff>>): Aff {
  let out = aff(a.c);
  for (const [n, k] of Object.entries(a.terms))
    out = affAdd(out, Object.hasOwn(map, n) ? map[n] : affName(n), k);
  return out;
}
/** The name, when the form is exactly one name (`N`, `i`). */
export function affPlain(a: Aff): string | undefined {
  const keys = Object.keys(a.terms);
  return a.c === 0 && keys.length === 1 && a.terms[keys[0]] === 1 ? keys[0] : undefined;
}
export function affText(a: Aff): string {
  let s = '';
  for (const [n, k] of Object.entries(a.terms)) {
    const mag = Math.abs(k) === 1 ? n : `${Math.abs(k)}*${n}`;
    s += s ? (k < 0 ? ` - ${mag}` : ` + ${mag}`) : k < 0 ? `-${mag}` : mag;
  }
  if (!s) return String(a.c);
  return a.c ? `${s} ${a.c < 0 ? '-' : '+'} ${Math.abs(a.c)}` : s;
}
export function affEval(a: Aff, env: Readonly<Record<string, number>>): number {
  let v = a.c;
  for (const [n, k] of Object.entries(a.terms)) v += k * env[n];
  return v;
}

export const extAff = (a: Aff): Extent => ({ k: 'aff', aff: a });
export function extSubst(e: Extent, map: Readonly<Record<string, Aff>>): Extent {
  if (e.k === 'aff') return extAff(affSubst(e.aff, map));
  if (e.k === 'min') return { k: 'min', a: extSubst(e.a, map), b: extSubst(e.b, map) };
  return { k: 'ceildiv', a: extSubst(e.a, map), by: e.by };
}
export function extNames(e: Extent, out: Set<string> = new Set()): Set<string> {
  if (e.k === 'aff') for (const n of Object.keys(e.aff.terms)) out.add(n);
  else if (e.k === 'min') (extNames(e.a, out), extNames(e.b, out));
  else extNames(e.a, out);
  return out;
}
export function extEval(e: Extent, env: Readonly<Record<string, number>>): number {
  if (e.k === 'aff') return affEval(e.aff, env);
  if (e.k === 'min') return Math.min(extEval(e.a, env), extEval(e.b, env));
  return Math.ceil(extEval(e.a, env) / e.by);
}

// ---------- expressions ----------
/** Rebuild an expression bottom-up: `f` sees each node after its children were mapped. */
export function mapExpr(e: Expr, f: (e: Expr) => Expr): Expr {
  switch (e.k) {
    case 'neg':
      return f({ ...e, a: mapExpr(e.a, f) });
    case 'bin':
      return f({ ...e, a: mapExpr(e.a, f), b: mapExpr(e.b, f) });
    case 'call':
      return f({ ...e, args: e.args.map(a => mapExpr(a, f)) });
    case 'reduce':
      return f({ ...e, body: mapExpr(e.body, f) });
    default:
      return f(e);
  }
}
export function walkExpr(e: Expr, f: (e: Expr) => void): void {
  f(e);
  if (e.k === 'neg') walkExpr(e.a, f);
  else if (e.k === 'bin') (walkExpr(e.a, f), walkExpr(e.b, f));
  else if (e.k === 'call') e.args.forEach(a => walkExpr(a, f));
  else if (e.k === 'reduce') walkExpr(e.body, f);
}
/** The tensors an expression references, one entry per occurrence, in tree order. */
export function refsOf(e: Expr): string[] {
  const out: string[] = [];
  walkExpr(e, n => void (n.k === 'ref' && out.push(n.tensor)));
  return out;
}
/** Replace index names by affine forms in every subscript and extent of an expression. */
export function substExpr(e: Expr, map: Readonly<Record<string, Aff>>): Expr {
  return mapExpr(e, n =>
    n.k === 'ref'
      ? { ...n, at: n.at.map(a => affSubst(a, map)) }
      : n.k === 'reduce'
        ? { ...n, indices: n.indices.map(i => ({ name: i.name, extent: extSubst(i.extent, map) })) }
        : n,
  );
}

// ---------- validation ----------
const CALL_ARITY: Readonly<Record<string, number>> = { exp: 1, log: 1, sqrt: 1, tanh: 1, max: 2, min: 2 };
const fail = (msg: string): never => {
  throw new Error(`tix-ir: ${msg}`);
};
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function checkAff(a: unknown, where: string, allowed: (name: string) => boolean): void {
  if (!isRecord(a) || !Number.isInteger(a.c) || !isRecord(a.terms)) fail(`${where}: not an affine form`);
  for (const [n, k] of Object.entries((a as unknown as Aff).terms)) {
    if (!Number.isInteger(k) || k === 0) fail(`${where}: coefficient of ${n} must be a non-zero integer`);
    if (!allowed(n)) fail(`${where}: unknown name ${n}`);
  }
}
function checkExtent(e: unknown, where: string, allowed: (name: string) => boolean): void {
  if (!isRecord(e)) fail(`${where}: not an extent`);
  const x = e as unknown as Extent;
  if (x.k === 'aff') checkAff(x.aff, where, allowed);
  else if (x.k === 'min') (checkExtent(x.a, where, allowed), checkExtent(x.b, where, allowed));
  else if (x.k === 'ceildiv') {
    if (!Number.isInteger(x.by) || x.by < 1) fail(`${where}: ceildiv by a positive integer`);
    checkExtent(x.a, where, allowed);
  } else fail(`${where}: unknown extent kind`);
}

/**
 * Structural validity: names resolve, ranks match, each extent mentions only shape names and indices bound outside
 * it, index names are not rebound on a path. Subscript bounds are not proved here (the checker proves them for
 * source programs; the evaluator checks them at run time).
 */
export function validateTix(value: unknown): void {
  if (!isRecord(value) || !isRecord(value.fns)) fail('a program is { fns }');
  for (const [key, f] of Object.entries((value as unknown as TixIR).fns)) {
    if (!isRecord(f) || f.name !== key) fail(`function ${key}: name does not match its key`);
    const where = `fn ${key}`;
    if (!Array.isArray(f.shapes) || !Array.isArray(f.params) || !Array.isArray(f.stmts))
      fail(`${where}: needs shapes, params and stmts`);
    const shapes = new Set<string>(f.shapes);
    const rank = new Map<string, number>();
    for (const p of f.params) {
      if (!isRecord(p) || typeof p.name !== 'string' || !Array.isArray(p.dims) || !p.dims.length)
        fail(`${where}: bad parameter`);
      if (rank.has(p.name) || shapes.has(p.name)) fail(`${where}: ${p.name} is defined twice`);
      p.dims.forEach(d => checkAff(d, `${where} parameter ${p.name}`, n => shapes.has(n)));
      rank.set(p.name, p.dims.length);
    }
    for (const s of f.stmts) {
      if (!isRecord(s) || typeof s.name !== 'string' || !Array.isArray(s.indices) || !s.indices.length)
        fail(`${where}: bad statement`);
      const at = `${where} statement ${s.name}`;
      if (rank.has(s.name) || shapes.has(s.name)) fail(`${where}: ${s.name} is defined twice`);
      const bound = new Set<string>();
      const bind = (indices: readonly Index[], outer: boolean) => {
        for (const i of indices) {
          if (!isRecord(i) || typeof i.name !== 'string') fail(`${at}: bad index`);
          // a statement's own extents are its tensor's shape: shape names only
          checkExtent(i.extent, `${at} index ${i.name}`, n => shapes.has(n) || (!outer && bound.has(n)));
          if (bound.has(i.name) || shapes.has(i.name)) fail(`${at}: index ${i.name} is bound twice`);
          bound.add(i.name);
        }
      };
      bind(s.indices, true);
      const visit = (e: Expr): void => {
        if (!isRecord(e)) fail(`${at}: bad expression`);
        switch (e.k) {
          case 'lit':
            if (typeof e.value !== 'number' || !Number.isFinite(e.value) || e.value < 0)
              fail(`${at}: a literal is a finite non-negative number`);
            return;
          case 'shape':
            if (!shapes.has(e.name)) fail(`${at}: unknown shape name ${e.name}`);
            return;
          case 'ref':
            if (!rank.has(e.tensor)) fail(`${at}: reads ${e.tensor}, which is not defined before it`);
            if (!Array.isArray(e.at) || e.at.length !== rank.get(e.tensor))
              fail(`${at}: ${e.tensor} has rank ${rank.get(e.tensor)}`);
            e.at.forEach(a => checkAff(a, `${at} subscript of ${e.tensor}`, n => bound.has(n)));
            return;
          case 'neg':
            return visit(e.a);
          case 'bin':
            if (!['+', '-', '*', '/'].includes(e.op)) fail(`${at}: unknown operator ${String(e.op)}`);
            return void (visit(e.a), visit(e.b));
          case 'call':
            if (
              CALL_ARITY[e.fn] === undefined ||
              !Array.isArray(e.args) ||
              e.args.length !== CALL_ARITY[e.fn]
            )
              fail(`${at}: bad call of ${String(e.fn)}`);
            return e.args.forEach(visit);
          case 'reduce': {
            if ((e.op !== 'sum' && e.op !== 'max') || !Array.isArray(e.indices) || !e.indices.length)
              fail(`${at}: bad reduction`);
            bind(e.indices, false);
            visit(e.body);
            for (const i of e.indices) bound.delete(i.name);
            return;
          }
          default:
            fail(`${at}: unknown expression kind`);
        }
      };
      visit(s.expr as Expr);
      rank.set(s.name, s.indices.length);
    }
    if (typeof f.result !== 'string' || !rank.has(f.result)) fail(`${where}: returns an undefined tensor`);
  }
}

// ---------- the framework's view ----------
export const TixIRType = defineIR<TixIR>({
  id: 'tensor.tix',
  version: '1',
  description: 'Tix functions as statements that are loop nests over expression trees',
  validate: validateTix,
});

const fnId = (f: string) => `fn:${f}`;
/** The entity id of a tensor of a function: a parameter or a statement. */
export function tensorId(f: Fn, name: string): string {
  return f.params.some(p => p.name === name) ? `param:${f.name}/${name}` : `stmt:${f.name}/${name}`;
}

function* entities(v: TixIR): Iterable<IREntity> {
  for (const f of Object.values(v.fns)) {
    yield { id: fnId(f.name), kind: 'fn', attributes: { shapes: f.shapes, result: f.result } };
    for (const p of f.params) yield { id: tensorId(f, p.name), kind: 'param', attributes: { dims: p.dims } };
    for (const s of f.stmts)
      yield { id: tensorId(f, s.name), kind: 'stmt', attributes: { indices: s.indices, expr: s.expr } };
  }
}
function* relations(v: TixIR): Iterable<IRRelation> {
  for (const f of Object.values(v.fns)) {
    let order = 0;
    for (const t of [...f.params, ...f.stmts]) {
      const to = tensorId(f, t.name);
      yield {
        id: `declares:${to}`,
        kind: 'declares',
        category: 'containment',
        from: fnId(f.name),
        to,
        order: order++,
      };
    }
    for (const s of f.stmts) {
      const from = tensorId(f, s.name);
      let k = 0;
      for (const t of refsOf(s.expr))
        yield {
          id: `reads:${from}#${k}`,
          kind: 'reads',
          category: 'dependency',
          from,
          to: tensorId(f, t),
          order: k++,
        };
    }
    yield {
      id: `returns:${f.name}`,
      kind: 'returns',
      category: 'binding',
      from: fnId(f.name),
      to: tensorId(f, f.result),
    };
  }
}

/** No `rebuild`: tensor passes return native values, so the logical graph is never translated back. */
export const tixAdapter = defineAdapter<TixIR>({
  id: 'adapter.tensor-tix',
  version: '1',
  kind: TixIRType.id,
  schemaVersion: TixIRType.version,
  description: 'Functions, parameters and statements with declares, reads and returns edges',
  relationKinds: { declares: 'containment', reads: 'dependency', returns: 'binding' },
  entities,
  resolve: (v, id) => {
    for (const e of entities(v)) if (e.id === id) return e;
    return undefined;
  },
  relations,
  roots: v => Object.keys(v.fns).map(fnId).sort(),
  describe: (_v, id) => ({ label: id }),
  validate: validateTix,
  serialize: v => JSON.stringify(v),
  deserialize: s => {
    const v = JSON.parse(s);
    validateTix(v);
    return v;
  },
});
