import { defineIR } from '../framework/contracts/definitions.js';
import { defineAdapter, type IREntity, type IRRelation } from '../framework/ir/index.js';
import { validate, walk, type Module } from './model.js';
const meta = {
  id: 'tix.indexed',
  version: '1',
  description: 'Ordered tensor definitions with explicit index domains',
};
export const Indexed = defineIR<Module>({ ...meta, validate });
function* entities(m: Module): Generator<IREntity> {
  for (const f of m) {
    yield { id: f.name, kind: 'fn', attributes: { result: f.result, ret: f.ret, at: f.at } };
    for (const p of f.params) yield { id: `${f.name}/${p.name}`, kind: 'param', attributes: { ...p } };
    for (const s of f.defs) yield { id: `${f.name}/${s.name}`, kind: 'def', attributes: { ...s } };
  }
}
function* relations(m: Module): Generator<IRRelation> {
  for (const f of m) {
    for (const [order, p] of [...f.params, ...f.defs].entries()) {
      const to = `${f.name}/${p.name}`;
      yield { id: `contains:${to}`, kind: 'contains', category: 'containment', from: f.name, to, order };
    }
    for (const s of f.defs) {
      const source = `${f.name}/${s.name}`;
      const reads = new Set([...walk(s.rhs)].flatMap(e => (e.op === 'read' ? [e.name] : [])));
      for (const n of reads)
        yield {
          id: `reads:${source}:${n}`,
          kind: 'reads',
          category: 'dependency',
          from: source,
          to: `${f.name}/${n}`,
        };
    }
  }
}
export const adapter = defineAdapter<Module>({
  ...meta,
  kind: meta.id,
  schemaVersion: meta.version,
  validate,
  entities,
  relations,
  relationKinds: { contains: 'containment', reads: 'dependency' },
  roots: m => m.map(f => f.name),
  resolve: (m, id) => [...entities(m)].find(e => e.id === id),
  describe: (_, id) => ({ label: id }),
});
