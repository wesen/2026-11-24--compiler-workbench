/**
 * IRWB-020-N: the Tix IR (`tensor.tix`, version 1), a statement-level index-notation IR stored as a v6 artifact.
 *
 * One record per Tix statement, with every index extent resolved and every reduction axis explicit, over a flat
 * table of expression nodes with stable ids (so passes can state correspondence). A statement is one loop nest:
 * a loop per left-hand index, and the reductions inside as inner loops in axis order, a guard being an `if`.
 * Extents are affine forms over the function's shape names; only `split-sum` introduces `div` (ceiling division
 * by a constant) and guards, because Tix has neither floor division nor conditionals.
 */
import { defineIR } from '../framework/contracts/definitions.js';
import { defineAdapter } from '../framework/ir/adapters.js';
import type { IREntity, IRRelation } from '../framework/ir/types.js';

// ---------- affine forms ----------

/** `c + Σ t[name]·name`: integer coefficients, keys sorted, no zero coefficient. */
export interface Affine {
  readonly c: number;
  readonly t: Readonly<Record<string, number>>;
}
/** `ceil(aff / div)`, `div` a positive integer; plain `aff` when absent. */
export interface Extent {
  readonly aff: Affine;
  readonly div?: number;
}

const norm = (c: number, t: Record<string, number>): Affine => {
  const out: Record<string, number> = {};
  for (const k of Object.keys(t).sort()) if (t[k] !== 0) out[k] = t[k];
  return { c, t: out };
};
export const A = {
  num: (c: number): Affine => ({ c, t: {} }),
  name: (n: string): Affine => ({ c: 0, t: { [n]: 1 } }),
  add(a: Affine, b: Affine): Affine {
    const t: Record<string, number> = { ...a.t };
    for (const [k, v] of Object.entries(b.t)) t[k] = (t[k] ?? 0) + v;
    return norm(a.c + b.c, t);
  },
  scale(a: Affine, k: number): Affine {
    return norm(a.c * k, Object.fromEntries(Object.entries(a.t).map(([n, v]) => [n, v * k])));
  },
  sub: (a: Affine, b: Affine): Affine => A.add(a, A.scale(b, -1)),
  eq: (a: Affine, b: Affine): boolean => A.show(a) === A.show(b),
  /** The name when `a` is exactly one name with coefficient 1 and no constant (a plain use). */
  plain(a: Affine): string | undefined {
    const ks = Object.keys(a.t);
    return a.c === 0 && ks.length === 1 && a.t[ks[0]] === 1 ? ks[0] : undefined;
  },
  names: (a: Affine): string[] => Object.keys(a.t),
  /** Replace names by affine forms (names not in `map` stay). */
  subst(a: Affine, map: Readonly<Record<string, Affine>>): Affine {
    let out = A.num(a.c);
    for (const [k, v] of Object.entries(a.t)) out = A.add(out, A.scale(map[k] ?? A.name(k), v));
    return out;
  },
  value(a: Affine, env: Readonly<Record<string, number>>): number {
    let v = a.c;
    for (const [k, x] of Object.entries(a.t)) {
      const e = env[k];
      if (e === undefined) throw new Error(`unbound name ${k}`);
      v += x * e;
    }
    return v;
  },
  show(a: Affine): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(a.t)) parts.push(v === 1 ? k : v === -1 ? `-${k}` : `${v}*${k}`);
    if (a.c !== 0 || !parts.length) parts.push(String(a.c));
    return parts.join(' + ').replace(/\+ -/g, '- ');
  },
};
export const extentValue = (e: Extent, env: Readonly<Record<string, number>>): number =>
  e.div ? Math.ceil(A.value(e.aff, env) / e.div) : A.value(e.aff, env);

/**
 * Provably non-negative for every assignment of shape values ≥ 1: every coefficient ≥ 0 and the value at all
 * ones ≥ 0. Sound, and complete for the affine forms the corpus needs.
 */
export const provablyNonNegative = (a: Affine): boolean =>
  Object.values(a.t).every(v => v >= 0) && a.c + Object.values(a.t).reduce((s, v) => s + v, 0) >= 0;

// ---------- the model ----------

export interface Param {
  readonly name: string;
  readonly dims: readonly Affine[];
}
export interface Fn {
  readonly name: string;
  readonly shapes: readonly string[];
  readonly params: readonly Param[];
  readonly result: readonly Affine[];
  /** Statement ids in program order. */
  readonly body: readonly string[];
  /** The returned statement's id. */
  readonly returns: string;
}
export interface Stmt {
  readonly id: string;
  readonly fn: string;
  readonly tensor: string;
  readonly indices: readonly { readonly name: string; readonly extent: Affine }[];
  readonly root: string;
  /** Source position `line:col` of the statement (for descriptions). */
  readonly at: string;
}
export interface Guard {
  readonly at: Affine;
  readonly lt: Affine;
}
export type Expr =
  | { readonly op: 'num'; readonly value: number }
  | { readonly op: 'shape'; readonly name: string }
  | {
      readonly op: 'ref';
      readonly kind: 'param' | 'stmt';
      readonly name: string;
      readonly at: readonly Affine[];
    }
  | { readonly op: 'neg' | 'exp' | 'log' | 'sqrt' | 'tanh'; readonly a: string }
  | { readonly op: 'add' | 'sub' | 'mul' | 'div' | 'max' | 'min'; readonly a: string; readonly b: string }
  | {
      readonly op: 'reduce';
      readonly kind: 'sum' | 'max';
      readonly axes: readonly { readonly name: string; readonly extent: Extent }[];
      readonly guard?: readonly Guard[];
      readonly blocked?: true;
      readonly body: string;
    };
export interface TixModule {
  readonly fns: Readonly<Record<string, Fn>>;
  readonly stmts: Readonly<Record<string, Stmt>>;
  readonly exprs: Readonly<Record<string, Expr>>;
  /** The next free number for `s<n>` and `e<n>` ids. */
  readonly next: number;
}

export const UNARY = new Set(['neg', 'exp', 'log', 'sqrt', 'tanh']);
export const BINARY = new Set(['add', 'sub', 'mul', 'div', 'max', 'min']);
/** The child expression ids of a node, in operand order. */
export function children(e: Expr): string[] {
  if (e.op === 'reduce') return [e.body];
  if ('b' in e) return [e.a, e.b];
  if ('a' in e) return [e.a];
  return [];
}

// ---------- bounds ----------

/** An index in scope: its extent, and the guards of the reduction that bound it (if any). */
export interface ScopeIndex {
  readonly extent: Extent;
}
export interface BoundsScope {
  readonly indices: ReadonlyMap<string, ScopeIndex>;
  readonly guards: readonly Guard[];
}

/** The minimum and maximum of `a` over the scope, as affine forms over shapes, or why they cannot be stated. */
export function indexRange(a: Affine, scope: BoundsScope): { min: Affine; max: Affine } | string {
  let rest = a;
  let min = A.num(0),
    max = A.num(0);
  // a guard `at < lt` bounds every multiple of `at` it fully contains
  for (const g of scope.guards) {
    const gk = A.names(g.at);
    if (!gk.length || !gk.every(k => k in rest.t)) continue;
    const m = rest.t[gk[0]] / g.at.t[gk[0]];
    if (!Number.isInteger(m) || !gk.every(k => rest.t[k] === m * g.at.t[k])) continue;
    // the guarded form's minimum: with non-negative coefficients it is its constant (every index starts at 0)
    if (!gk.every(k => g.at.t[k] > 0)) continue;
    const lo = A.num(g.at.c),
      hi = A.sub(g.lt, A.num(1));
    min = A.add(min, A.scale(m > 0 ? lo : hi, m));
    max = A.add(max, A.scale(m > 0 ? hi : lo, m));
    rest = A.sub(rest, A.scale(g.at, m));
  }
  min = A.add(min, A.num(rest.c));
  max = A.add(max, A.num(rest.c));
  for (const [k, v] of Object.entries(rest.t)) {
    const ix = scope.indices.get(k);
    if (!ix) return `index ${k} is not in scope`;
    if (ix.extent.div)
      return `cannot bound index ${k}: its extent is a ceiling division and no guard covers it`;
    const top = A.scale(A.sub(ix.extent.aff, A.num(1)), v);
    if (v > 0) max = A.add(max, top);
    else min = A.add(min, top);
  }
  return { min, max };
}

/** Why the reference `at` into a tensor of dimensions `dims` may be out of bounds, or undefined when it is in. */
export function boundsProblem(
  at: readonly Affine[],
  dims: readonly Affine[],
  scope: BoundsScope,
): string | undefined {
  for (let d = 0; d < at.length; d++) {
    const r = indexRange(at[d], scope);
    if (typeof r === 'string') return r;
    if (!provablyNonNegative(r.min)) return `index ${A.show(at[d])} may be negative`;
    if (!provablyNonNegative(A.sub(A.sub(dims[d], A.num(1)), r.max)))
      return `index ${A.show(at[d])} may exceed dimension ${A.show(dims[d])} (its maximum is ${A.show(r.max)})`;
  }
  return undefined;
}

// ---------- validation ----------

/** An IR value that is not a valid `tensor.tix` module (a pass bug, never a source error). */
export class TixIRError extends Error {
  constructor(message: string) {
    super(`tensor.tix: ${message}`);
    this.name = 'TixIRError';
  }
}
const fail = (msg: string): never => {
  throw new TixIRError(msg);
};
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
function checkAffine(a: unknown, allowed: (n: string) => boolean, where: string): Affine {
  const x = a as Affine;
  if (!x || typeof x !== 'object' || !isInt(x.c) || !x.t || typeof x.t !== 'object')
    fail(`${where}: bad affine form`);
  const ks = Object.keys(x.t);
  if (ks.join('\u0000') !== [...ks].sort().join('\u0000')) fail(`${where}: affine keys not sorted`);
  for (const k of ks) {
    if (!isInt(x.t[k]) || x.t[k] === 0) fail(`${where}: bad coefficient of ${k}`);
    if (!allowed(k)) fail(`${where}: ${k} is not in scope`);
  }
  return x;
}
const shapeOf = (st: Stmt): Affine[] => st.indices.map(i => i.extent);

/** Structure, scoping, ranks and bounds; a pass whose output fails this is rejected before its contract runs. */
export function validateModule(value: unknown): void {
  const m = value as TixModule;
  if (!m || typeof m !== 'object' || !m.fns || !m.stmts || !m.exprs || !isInt(m.next)) fail('not a module');
  const idNum = (id: string, p: string) => {
    const n = id.startsWith(p) ? Number(id.slice(p.length)) : NaN;
    if (!isInt(n) || n >= m.next) fail(`bad id ${id}`);
  };
  const owner = new Map<string, string>();
  for (const [fname, f] of Object.entries(m.fns)) {
    if (f.name !== fname) fail(`function ${fname} misnamed`);
    const shapes = new Set(f.shapes);
    const isShape = (n: string) => shapes.has(n);
    const plainShapes = new Set<string>();
    const tensors = new Map<string, readonly Affine[]>();
    for (const p of f.params) {
      if (tensors.has(p.name)) fail(`${fname}: duplicate parameter ${p.name}`);
      if (!p.dims.length) fail(`${fname}: parameter ${p.name} has no dimensions`);
      p.dims.forEach(d => {
        checkAffine(d, isShape, `${fname}.${p.name}`);
        const n = A.plain(d);
        if (n) plainShapes.add(n);
      });
      tensors.set(`param:${p.name}`, p.dims);
    }
    for (const s of f.shapes)
      if (!plainShapes.has(s)) fail(`${fname}: shape ${s} is not a plain parameter dimension`);
    f.result.forEach(d => checkAffine(d, isShape, `${fname} result`));
    if (!f.body.includes(f.returns)) fail(`${fname}: returns ${f.returns}, which is not in its body`);
    for (const sid of f.body) {
      idNum(sid, 's');
      const st = m.stmts[sid];
      if (!st || st.id !== sid || st.fn !== fname) fail(`${fname}: bad statement ${sid}`);
      const scope = new Map<string, ScopeIndex>();
      for (const ix of st.indices) {
        if (scope.has(ix.name) || shapes.has(ix.name)) fail(`${sid}: index ${ix.name} reused`);
        checkAffine(ix.extent, isShape, `${sid}.${ix.name}`);
        scope.set(ix.name, { extent: { aff: ix.extent } });
      }
      if (!st.indices.length) fail(`${sid}: no indices`);
      const visit = (eid: string, sc: Map<string, ScopeIndex>, guards: readonly Guard[]): void => {
        idNum(eid, 'e');
        if (owner.has(eid)) fail(`expression ${eid} is shared (by ${owner.get(eid)} and ${sid})`);
        owner.set(eid, sid);
        const e = m.exprs[eid];
        if (!e) fail(`${sid}: missing expression ${eid}`);
        const where = `${sid}/${eid}`;
        switch (e.op) {
          case 'num':
            if (typeof e.value !== 'number' || !Number.isFinite(e.value)) fail(`${where}: bad number`);
            return;
          case 'shape':
            if (!shapes.has(e.name)) fail(`${where}: ${e.name} is not a shape`);
            return;
          case 'ref': {
            const dims = tensors.get(`${e.kind}:${e.name}`);
            if (!dims) fail(`${where}: ${e.kind} ${e.name} is not defined before ${sid}`);
            if (e.at.length !== dims!.length) fail(`${where}: rank ${e.at.length}, expected ${dims!.length}`);
            e.at.forEach(a => checkAffine(a, n => sc.has(n), where));
            const why = boundsProblem(e.at, dims!, { indices: sc, guards });
            if (why) fail(`${where}: ${why}`);
            return;
          }
          case 'reduce': {
            if (e.kind !== 'sum' && e.kind !== 'max') fail(`${where}: bad reduction`);
            if (!e.axes.length) fail(`${where}: no axes`);
            const inner = new Map(sc);
            for (const ax of e.axes) {
              if (inner.has(ax.name) || shapes.has(ax.name)) fail(`${where}: axis ${ax.name} reused`);
              checkAffine(ax.extent.aff, isShape, where);
              if (ax.extent.div !== undefined && !(isInt(ax.extent.div) && ax.extent.div > 0))
                fail(`${where}: bad divisor`);
              inner.set(ax.name, { extent: ax.extent });
            }
            for (const g of e.guard ?? []) {
              checkAffine(g.at, n => inner.has(n), where);
              checkAffine(g.lt, isShape, where);
            }
            visit(e.body, inner, [...guards, ...(e.guard ?? [])]);
            return;
          }
          default:
            if (UNARY.has(e.op) || BINARY.has(e.op)) {
              for (const c of children(e)) visit(c, sc, guards);
              return;
            }
            fail(`${where}: unknown operator ${(e as { op: string }).op}`);
        }
      };
      visit(st.root, scope, []);
      tensors.set(`stmt:${sid}`, shapeOf(st));
    }
    const ret = m.stmts[f.returns];
    const rs = shapeOf(ret);
    if (rs.length !== f.result.length || rs.some((d, i) => !A.eq(d, f.result[i])))
      fail(`${fname}: returned shape does not match the result type`);
  }
  for (const [sid, st] of Object.entries(m.stmts))
    if (!m.fns[st.fn]?.body.includes(sid)) fail(`statement ${sid} belongs to no function`);
  for (const eid of Object.keys(m.exprs)) if (!owner.has(eid)) fail(`expression ${eid} is unreachable`);
}

export const TixIR = defineIR<TixModule>({
  id: 'tensor.tix',
  version: '1',
  description: 'Tix functions as statements over index spaces with explicit extents and expression trees',
  validate: validateModule,
});

// ---------- the v6 projection ----------

const ent = (id: string, kind: string, attributes: Record<string, unknown> = {}): IREntity => ({
  id,
  kind,
  attributes,
});
function exprAttributes(e: Expr): Record<string, unknown> {
  const { op: _op, ...rest } = e as Expr & Record<string, unknown>;
  delete rest.a;
  delete rest.b;
  delete rest.body;
  return rest;
}
function* entities(m: TixModule): Iterable<IREntity> {
  for (const f of Object.values(m.fns)) {
    yield ent(`fn:${f.name}`, 'fn', { shapes: f.shapes, result: f.result });
    for (const p of f.params) yield ent(`param:${f.name}/${p.name}`, 'param', { dims: p.dims });
  }
  for (const s of Object.values(m.stmts))
    yield ent(`stmt:${s.id}`, 'stmt', { tensor: s.tensor, indices: s.indices, at: s.at });
  for (const [id, e] of Object.entries(m.exprs)) yield ent(`expr:${id}`, `expr.${e.op}`, exprAttributes(e));
}
function resolve(m: TixModule, id: string): IREntity | undefined {
  const [k, rest] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  if (k === 'fn' && m.fns[rest])
    return ent(id, 'fn', { shapes: m.fns[rest].shapes, result: m.fns[rest].result });
  if (k === 'param') {
    const [fn, name] = rest.split('/');
    const p = m.fns[fn]?.params.find(x => x.name === name);
    return p && ent(id, 'param', { dims: p.dims });
  }
  if (k === 'stmt' && m.stmts[rest]) {
    const s = m.stmts[rest];
    return ent(id, 'stmt', { tensor: s.tensor, indices: s.indices, at: s.at });
  }
  if (k === 'expr' && m.exprs[rest])
    return ent(id, `expr.${m.exprs[rest].op}`, exprAttributes(m.exprs[rest]));
  return undefined;
}
function* relations(m: TixModule): Iterable<IRRelation> {
  for (const f of Object.values(m.fns)) {
    for (const [i, sid] of f.body.entries())
      yield {
        id: `contains:${sid}`,
        kind: 'contains',
        category: 'containment',
        from: `fn:${f.name}`,
        to: `stmt:${sid}`,
        order: i,
      };
    yield {
      id: `returns:${f.name}`,
      kind: 'returns',
      category: 'dependency',
      from: `fn:${f.name}`,
      to: `stmt:${f.returns}`,
    };
  }
  for (const s of Object.values(m.stmts)) {
    yield {
      id: `root:${s.id}`,
      kind: 'root',
      category: 'containment',
      from: `stmt:${s.id}`,
      to: `expr:${s.root}`,
    };
    const walk = function* (eid: string): Iterable<IRRelation> {
      const e = m.exprs[eid];
      if (e.op === 'ref')
        yield {
          id: `reads:${eid}`,
          kind: 'reads',
          category: 'dependency',
          from: `expr:${eid}`,
          to: e.kind === 'param' ? `param:${s.fn}/${e.name}` : `stmt:${e.name}`,
        };
      for (const [i, c] of children(e).entries()) {
        yield {
          id: `operand:${eid}/${i}`,
          kind: 'operand',
          category: 'dependency',
          from: `expr:${eid}`,
          to: `expr:${c}`,
          order: i,
        };
        yield* walk(c);
      }
    };
    yield* walk(s.root);
  }
}

export const tixAdapter = defineAdapter<TixModule>({
  id: 'adapter.tensor-tix',
  version: '1',
  kind: TixIR.id,
  schemaVersion: TixIR.version,
  description:
    'Functions, parameters, statements and expression nodes with containment, operand and read edges',
  relationKinds: {
    contains: 'containment',
    root: 'containment',
    operand: 'dependency',
    reads: 'dependency',
    returns: 'dependency',
  },
  entities,
  resolve,
  relations,
  roots: m =>
    Object.keys(m.fns)
      .sort()
      .map(n => `fn:${n}`),
  describe: (m, id) => {
    const s = id.startsWith('stmt:') ? m.stmts[id.slice(5)] : undefined;
    return { label: s ? `${s.tensor}[${s.indices.map(i => i.name).join(', ')}] at ${s.at}` : id };
  },
  validate: validateModule,
  operation: (m, id) => {
    const e = id.startsWith('expr:') ? m.exprs[id.slice(5)] : undefined;
    return e && { name: e.op, operands: children(e).map(c => `expr:${c}`) };
  },
  serialize: m => JSON.stringify(m),
  deserialize: text => {
    const m = JSON.parse(text);
    validateModule(m);
    return m;
  },
});
