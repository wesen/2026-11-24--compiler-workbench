import { defineIR } from '../framework/contracts/definitions.js';
import { defineAdapter } from '../framework/ir/index.js';
import type { IREntity, IRRelation } from '../framework/ir/index.js';
import { add, endpoints, fail, sameShape, scale, symbols, walk } from './model.js';
import type { Affine, Axis, Expr, Module } from './model.js';

function validate(value: unknown): void {
  const m = value as Module;
  if (!Array.isArray(m.functions) || !m.functions.length) throw Error('expected Tix functions');
  const names = new Set<string>();
  for (const f of m.functions) {
    const at = '1:1',
      known = new Set(symbols(f));
    const tensors = new Map<string, Affine[]>();
    const dim = (a: Affine, allowed: ReadonlySet<string>, loc: string) => {
      if (!Number.isSafeInteger(a.constant) || !Array.isArray(a.terms)) fail(loc, 'invalid affine constant');
      let prev: string | undefined;
      for (const [n, k] of a.terms) {
        if (!allowed.has(n) || !Number.isSafeInteger(k) || k === 0 || (prev !== undefined && prev >= n))
          fail(loc, 'invalid affine term ' + n);
        prev = n;
      }
    };
    const shape = (dims: Affine[], loc: string) => {
      if (!dims.length) fail(loc, 'empty tensor rank');
      for (const a of dims) {
        dim(a, known, loc);
        if (!a.terms.length && a.constant < 0) fail(loc, 'negative extent');
      }
    };
    if (!f.name || names.has(f.name) || !f.params.length) fail(at, 'invalid function');
    names.add(f.name);
    function define(n: string, d: Affine[]) {
      if (!n || tensors.has(n)) fail(at, 'duplicate tensor ' + n);
      shape(d, at);
      tensors.set(n, d);
    }
    for (const p of f.params) define(p.name, p.shape);
    function withAxes(scope: Map<string, Affine>, axes: Axis[], loc: string) {
      const inner = new Map(scope);
      shape(
        axes.map(a => a.extent),
        loc,
      );
      for (const a of axes) {
        if (!a.id || inner.has(a.id)) fail(loc, 'duplicate binder');
        inner.set(a.id, a.extent);
      }
      return inner;
    }
    const check = (e: Expr, scope: Map<string, Affine>) => {
      switch (e.kind) {
        case 'literal':
          if (typeof e.value !== 'string' || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(e.value))
            fail(e.at, 'invalid literal');
          break;
        case 'shape':
          if (!known.has(e.name)) fail(e.at, 'unknown shape');
          break;
        case 'load': {
          const d = tensors.get(e.tensor);
          if (!d || d.length !== e.indices.length) fail(e.at, 'invalid load ' + e.tensor);
          e.indices.forEach((idx, i) => {
            dim(idx, new Set(scope.keys()), e.at);
            if ([...scope.values()].some(a => !a.terms.length && a.constant === 0)) return;
            const [lo, hi] = endpoints(idx, scope),
              excess = add(hi, scale(d[i], -1));
            if ((!lo.terms.length && lo.constant < 0) || (!excess.terms.length && excess.constant >= 0))
              fail(e.at, 'out-of-bounds subscript of ' + e.tensor);
          });
          break;
        }
        case 'unary':
          if (!['-', 'exp', 'log', 'sqrt', 'tanh'].includes(e.op)) fail(e.at, 'invalid unary operator');
          check(e.arg, scope);
          break;
        case 'binary':
          if (!['+', '-', '*', '/', 'min', 'max'].includes(e.op)) fail(e.at, 'invalid binary operator');
          check(e.left, scope);
          check(e.right, scope);
          break;
        case 'blocked':
        case 'reduce':
          if (
            e.kind === 'blocked'
              ? e.axes.length !== 1 || !Number.isSafeInteger(e.size) || e.size < 1
              : !['sum', 'max'].includes(e.op)
          )
            fail(e.at, 'invalid reduction');
          check(e.body, withAxes(scope, e.axes, e.at));
          break;
        default:
          fail(at, 'unknown expression kind');
      }
    };
    for (const s of f.statements) {
      check(s.expr, withAxes(new Map(), s.axes, s.expr.at));
      define(
        s.name,
        s.axes.map(a => a.extent),
      );
    }
    shape(f.shape, at);
    if (!sameShape(f.shape, tensors.get(f.result) ?? [])) fail(at, 'invalid return type');
  }
}
export const TixIR = defineIR<Module>({
  id: 'tensor.tix',
  version: '1',
  description: 'Checked Tix tensor functions',
  validate,
});
function projection(m: Module) {
  const entities = new Map<string, IREntity>(),
    relations: IRRelation[] = [];
  for (const f of m.functions) {
    const root = f.name;
    entities.set(root, { id: root, kind: 'tix.function', attributes: { shape: f.shape } });
    function edge(from: string, to: string, kind: string, category: IRRelation['category'], order: number) {
      relations.push({ id: [from, kind, to, order].join(':'), from, to, kind, category, order });
    }
    function entity(name: string, kind: string, attributes: IREntity['attributes'], order: number) {
      const id = root + '/' + name;
      entities.set(id, { id, kind, attributes });
      edge(root, id, 'contains', 'containment', order);
      return id;
    }
    f.params.forEach((p, i) => entity(p.name, 'tix.param', { shape: p.shape }, i));
    f.statements.forEach((s, i) => {
      const id = entity(s.name, 'tix.statement', { axes: s.axes, expr: s.expr }, i + f.params.length);
      let occurrence = 0;
      walk(s.expr, e => {
        if (e.kind === 'load') edge(id, root + '/' + e.tensor, 'reads', 'dependency', occurrence++);
      });
    });
    edge(root, root + '/' + f.result, 'returns', 'binding', 0);
  }
  return { entities, relations };
}
const projections = new WeakMap<Module, ReturnType<typeof projection>>();
function graph(m: Module) {
  let result = projections.get(m);
  if (!result) {
    result = projection(m);
    projections.set(m, result);
  }
  return result;
}
export const adapter = defineAdapter<Module>({
  id: 'tix.projection',
  version: '1',
  kind: TixIR.id,
  schemaVersion: TixIR.version,
  description: TixIR.description,
  validate,
  relationKinds: { contains: 'containment', reads: 'dependency', returns: 'binding' },
  entities: m => graph(m).entities.values(),
  resolve: (m, id) => graph(m).entities.get(id),
  relations: m => graph(m).relations,
  describe: (_m, id) => ({ label: id }),
  roots: m => m.functions.map(f => f.name),
});
