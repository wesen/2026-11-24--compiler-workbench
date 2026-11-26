import { defineIR } from '../framework/contracts/index.js';
import { isCanonical } from '../framework/core/data.js';
import { defineAdapter } from '../framework/ir/index.js';
import type { IREntity, IRRelation } from '../framework/ir/index.js';
import { validateModule } from './check.js';
import { children } from './model.js';
import type { Axis, Expr, Loc, TensorModule } from './model.js';

export const TensorIR = defineIR<TensorModule>({
  id: 'tensor.tix',
  version: '1',
  description: 'Resolved Tix tensor expressions and ordered index domains',
  validate: validateModule,
});

const kinds = {
  contains: 'containment',
  reads: 'dependency',
  binds: 'binding',
  returns: 'dependency',
} as const;

function project(module: TensorModule) {
  const entities = new Map<string, IREntity>(),
    relations: IRRelation[] = [];
  const entity = ({ id, at }: { id: string; at: Loc }, kind: string, attributes: object) =>
    entities.set(id, { id, kind, attributes: { ...attributes, at } });
  const edge = (kind: keyof typeof kinds, from: string, to: string, order: number, attributes?: object) =>
    relations.push({
      id: `${from}/${kind}/${order}/${to}`,
      from,
      to,
      kind,
      category: kinds[kind],
      order,
      ...(attributes ? { attributes: { ...attributes } } : {}),
    });
  const axis = (a: Axis) => entity(a, 'axis', { name: a.name, extent: a.extent });
  const expr = (e: Expr) => {
    const fields =
      e.op === 'literal'
        ? { text: e.text }
        : e.op === 'shape'
          ? { name: e.name }
          : e.op === 'call'
            ? { fn: e.fn }
            : e.op === 'load'
              ? { subs: e.subs }
              : e.op === 'blockedSum'
                ? { blockSize: e.blockSize }
                : {};
    entity(e, `expr.${e.op}`, fields);
    if (e.op === 'load') {
      edge('reads', e.id, e.tensor, 0);
      let order = 0;
      e.subs.forEach((sub, axis) =>
        sub.terms.forEach(([id, coefficient]) => edge('binds', e.id, id, order++, { axis, coefficient })),
      );
    }
    const axes = e.op === 'sum' || e.op === 'max' ? e.axes : e.op === 'blockedSum' ? [e.axis] : [];
    axes.forEach((a, i) => {
      axis(a);
      edge('contains', e.id, a.id, i);
    });
    children(e).forEach((c, i) => {
      expr(c);
      edge('contains', e.id, c.id, axes.length + i);
    });
  };
  for (const [i, f] of module.functions.entries()) {
    entity(f, 'function', { name: f.name, shapes: f.shapes, resultShape: f.resultShape, order: i });
    f.params.forEach((p, j) => {
      entity(p, 'param', { name: p.name, shape: p.shape });
      edge('contains', f.id, p.id, j);
    });
    f.statements.forEach((s, j) => {
      entity(s, 'statement', { name: s.name, shape: s.shape });
      edge('contains', f.id, s.id, f.params.length + j);
      s.axes.forEach((a, k) => {
        axis(a);
        edge('contains', s.id, a.id, k);
      });
      expr(s.expr);
      edge('contains', s.id, s.expr.id, s.axes.length);
    });
    edge('returns', f.id, f.result, 0);
  }
  return { entities, relations };
}

const projections = new WeakMap<TensorModule, ReturnType<typeof project>>();
function projection(module: TensorModule) {
  if (!isCanonical(module)) return project(module);
  let p = projections.get(module);
  if (!p) {
    p = project(module);
    projections.set(module, p);
  }
  return p;
}

export const tensorAdapter = defineAdapter<TensorModule>({
  id: 'tensor.tix-tree',
  version: '1',
  kind: TensorIR.id,
  schemaVersion: TensorIR.version,
  description: 'Ordered tensor definitions, expression trees, and lexical index bindings',
  validate: TensorIR.validate,
  relationKinds: kinds,
  entities: m => projection(m).entities.values(),
  resolve: (m, id) => projection(m).entities.get(id),
  relations: m => projection(m).relations,
  roots: m => m.functions.map(f => f.id),
  describe(m, id) {
    const e = projection(m).entities.get(id);
    return { label: String(e?.attributes.name ?? e?.kind ?? id) };
  },
});
