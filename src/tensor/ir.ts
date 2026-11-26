import { defineIR } from '../framework/contracts/index.js';
import { defineAdapter, type IREntity, type IRRelation } from '../framework/ir/index.js';
import { validateTensor } from './check.js';
import { expressions, type Param, type Stmt, type TensorIR } from './model.js';

export const IndexedIR = defineIR<TensorIR>({
  id: 'tensor.indexed',
  version: '1',
  description: 'Ordered indexed tensor definitions with scoped scalar expressions',
  validate: validateTensor,
});

export const tensorId = (fn: string, tensor: string): string => `${fn}/${tensor}`;
function projection(ir: TensorIR) {
  const entities = new Map<string, IREntity>(),
    relations: IRRelation[] = [];
  for (const { name, at, result, params, statements, return: ret } of ir.functions) {
    entities.set(name, { id: name, kind: 'function', attributes: { name, at, result } });
    const all: (Param | Stmt)[] = [...params, ...statements];
    all.forEach((tensor, order) => {
      const id = tensorId(name, tensor.name);
      const kind = 'expr' in tensor ? 'statement' : 'parameter';
      entities.set(id, { id, kind, attributes: { ...tensor } });
      relations.push({
        id: `contains:${id}`,
        from: name,
        to: id,
        kind: 'contains',
        category: 'containment',
        order,
      });
      if ('expr' in tensor) {
        let i = 0;
        for (const e of expressions(tensor.expr))
          if (e.tag === 'load') {
            relations.push({
              id: `read:${id}:${i}`,
              from: id,
              to: tensorId(name, e.load.tensor),
              kind: 'reads',
              category: 'dependency',
              order: i++,
            });
          }
      }
    });
    relations.push({
      id: `return:${name}`,
      from: name,
      to: tensorId(name, ret),
      kind: 'returns',
      category: 'binding',
    });
  }
  return { entities, relations };
}
const projections = new WeakMap<TensorIR, ReturnType<typeof projection>>();
function graph(ir: TensorIR) {
  let g = projections.get(ir);
  if (!g) {
    g = projection(ir);
    projections.set(ir, g);
  }
  return g;
}

export const indexedAdapter = defineAdapter<TensorIR>({
  id: 'adapter.tensor-indexed',
  version: '1',
  kind: IndexedIR.id,
  schemaVersion: IndexedIR.version,
  description: IndexedIR.description,
  validate: validateTensor,
  relationKinds: { contains: 'containment', reads: 'dependency', returns: 'binding' },
  entities: ir => graph(ir).entities.values(),
  resolve: (ir, id) => graph(ir).entities.get(id),
  relations: ir => graph(ir).relations,
  roots: ir => ir.functions.map(f => f.name),
  describe: (_ir, id) => ({ label: id }),
});
