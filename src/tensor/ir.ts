import { defineIR } from '../framework/contracts/definitions.js';
import { defineAdapter, type IREntity, type IRRelation } from '../framework/ir/index.js';
import {
  add,
  arities,
  constant,
  fail,
  plain,
  same,
  type Aff,
  type Binder,
  type Def,
  type Expr,
  type Program,
} from './model.js';

function checkAff(a: Aff, names: { has(s: string): boolean }, at: string) {
  if (!Number.isSafeInteger(a.c)) fail(at, 'invalid affine constant');
  let prev: string | undefined;
  for (const [k, n] of a.terms) {
    if (!names.has(k)) fail(at, `unknown variable ${k}`);
    if (!Number.isSafeInteger(n) || n === 0 || (prev !== undefined && k <= prev))
      fail(at, 'invalid affine coefficient');
    prev = k;
  }
}
// Detect unavoidable failures without assuming a concrete value for a symbolic extent.
function negative(a: Aff) {
  return a.c < 0 && a.terms.every(([, n]) => n <= 0);
}
export function validate(value: unknown): asserts value is Program {
  const p = value as Program,
    fnNames = new Set<string>();
  if (!p.functions.length) throw new Error('1:1: empty program');
  for (const f of p.functions) {
    if (fnNames.has(f.name)) fail(f.at, 'duplicate function');
    fnNames.add(f.name);
    const names = new Set(
      f.params.flatMap(p => p.shape.map(plain).filter((k): k is string => k !== undefined)),
    );
    function dim(a: Aff, at: string) {
      checkAff(a, names, at);
      if (negative(a)) fail(at, 'negative extent');
    }
    const defs = new Map<string, Def>(),
      defNames = new Set<string>();
    function define(d: Def) {
      if (defNames.has(d.name)) fail(d.at, 'duplicate tensor');
      defNames.add(d.name);
      if (!d.shape.length) fail(d.at, 'empty shape');
      d.shape.forEach(a => dim(a, d.at));
      defs.set(d.id, d);
    }
    f.params.forEach(define);
    function extend(outer: Map<string, Binder>, axes: Binder[]) {
      const scope = new Map(outer);
      if (!axes.length) fail(f.at, 'empty binder list');
      for (const b of axes) {
        dim(b.dim, b.at);
        if (b.loop) {
          if (b.loop.kind === 'lanes') {
            const parent = scope.get(b.loop.block);
            if (parent?.loop?.kind !== 'blocks' || !same(b.dim, parent.dim))
              fail(b.at, 'invalid block reference');
          } else if (b.loop.kind !== 'blocks' || !['ceil', 'floor'].includes(b.loop.round))
            fail(b.at, 'invalid block range');
        }
        scope.set(b.id, b);
      }
      return scope;
    }
    function expr(e: Expr, scope: Map<string, Binder>) {
      switch (e.tag) {
        case 'literal':
          if (!/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(e.text)) fail(e.at, 'invalid literal');
          break;
        case 'shape':
          if (!names.has(e.name)) fail(e.at, 'unknown shape');
          break;
        case 'op':
          if (e.args.length !== arities.get(e.op)) fail(e.at, 'invalid operation');
          e.args.forEach(a => expr(a, scope));
          break;
        case 'reduce':
          if (e.op !== 'sum' && e.op !== 'max') fail(e.at, 'unknown reduction');
          expr(e.body, extend(scope, e.axes));
          break;
        case 'load': {
          const d = defs.get(e.def) ?? fail(e.at, 'unavailable tensor');
          if (e.subs.length !== d.shape.length) fail(e.at, 'rank mismatch');
          e.subs.forEach((a, i) => {
            checkAff(a, scope, e.at);
            if (
              [...scope.values()].some(b => !b.dim.terms.length && b.dim.c === 0) ||
              a.terms.some(([k]) => scope.get(k)!.loop)
            )
              return;
            let lo = constant(a.c),
              hi = lo;
            for (const [k, n] of a.terms) {
              const last = add(scope.get(k)!.dim, constant(-1));
              if (n < 0) lo = add(lo, last, n);
              else hi = add(hi, last, n);
            }
            if (negative(lo) || negative(add(add(d.shape[i], constant(-1)), hi, -1)))
              fail(e.at, 'subscript out of bounds');
          });
          break;
        }
        default:
          throw new Error('unknown scalar node');
      }
    }
    for (const s of f.stmts) {
      if (s.shape.length !== s.axes.length || !s.axes.every((b, i) => !b.loop && same(b.dim, s.shape[i])))
        fail(s.at, 'assignment shape mismatch');
      expr(s.body, extend(new Map(), s.axes));
      define(s);
    }
    const d = defs.get(f.result);
    if (!d || f.shape.length !== d.shape.length || !f.shape.every((a, i) => same(a, d.shape[i])))
      fail(f.at, 'invalid return');
  }
}
export const TensorIR = defineIR<Program>({
  id: 'tensor.index',
  version: '1',
  description: 'Tix index program',
  validate,
});
const kinds = {
  contains: 'containment',
  reads: 'dependency',
  index: 'binding',
  returns: 'dependency',
} as const;
function projection(p: Program) {
  const entities = new Map<string, IREntity>(),
    relations: IRRelation[] = [];
  function put(id: string, kind: string, attributes: Record<string, unknown>) {
    if (entities.has(id)) throw new Error(`duplicate id ${id}`);
    entities.set(id, { id, kind, attributes });
  }
  function link(from: string, to: string, kind: keyof typeof kinds, order: number) {
    relations.push({ id: `${from}/${kind}/${order}`, from, to, kind, category: kinds[kind], order });
  }
  function binder(b: Binder, parent: string, i: number) {
    const { id, ...attrs } = b;
    put(id, 'binder', attrs);
    link(parent, id, 'contains', i);
    if (b.loop?.kind === 'lanes') link(id, b.loop.block, 'index', 0);
  }
  function expr(e: Expr, parent: string, i: number) {
    link(parent, e.id, 'contains', i);
    const { id, at, tag } = e;
    switch (e.tag) {
      case 'literal':
        put(id, tag, { at, text: e.text });
        break;
      case 'shape':
        put(id, tag, { at, name: e.name });
        break;
      case 'load': {
        put(id, tag, { at, subs: e.subs });
        link(id, e.def, 'reads', 0);
        [...new Set(e.subs.flatMap(a => a.terms.map(([k]) => k)))].forEach((k, j) => link(id, k, 'index', j));
        break;
      }
      case 'op':
        put(id, tag, { at, op: e.op });
        e.args.forEach((a, j) => expr(a, id, j));
        break;
      case 'reduce':
        put(id, tag, { at, op: e.op });
        e.axes.forEach((b, j) => binder(b, id, j));
        expr(e.body, id, e.axes.length);
        break;
    }
  }
  for (const [i, f] of p.functions.entries()) {
    put(f.id, 'function', { name: f.name, shape: f.shape, at: f.at, order: i });
    link(f.id, f.result, 'returns', 0);
    f.params.forEach((d, j) => {
      put(d.id, 'parameter', { name: d.name, at: d.at, shape: d.shape });
      link(f.id, d.id, 'contains', j);
    });
    f.stmts.forEach((s, j) => {
      put(s.id, 'assignment', { name: s.name, at: s.at, shape: s.shape });
      link(f.id, s.id, 'contains', f.params.length + j);
      s.axes.forEach((b, k) => binder(b, s.id, k));
      expr(s.body, s.id, s.axes.length);
    });
  }
  return { entities, relations };
}
const cache = new WeakMap<Program, ReturnType<typeof projection>>();
function graph(p: Program) {
  let g = cache.get(p);
  if (!g) {
    g = projection(p);
    if (Object.isFrozen(p)) cache.set(p, g);
  }
  return g;
}
export const adapter = defineAdapter<Program>({
  id: 'tensor.projection',
  version: '1',
  kind: TensorIR.id,
  schemaVersion: TensorIR.version,
  description: 'Ordered definitions and scoped scalar trees',
  relationKinds: kinds,
  validate,
  entities: p => graph(p).entities.values(),
  relations: p => graph(p).relations,
  resolve: (p, id) => graph(p).entities.get(id),
  roots: p => p.functions.map(f => f.id),
  describe: (p, id) => ({ label: `${graph(p).entities.get(id)?.kind} ${id}` }),
});
