import { defineIR } from '../framework/contracts/index.js';
import { createIRArtifact, defineAdapter, type IREntity, type IRRelation } from '../framework/ir/index.js';
import { validateTensorIR } from './check.js';
import { visitExpr, type TensorIR, type TixFunction } from './model.js';

export const TensorProgramIR = defineIR<TensorIR>({
  id: 'tensor.tix',
  version: '1',
  description: 'Checked tensor functions in index notation',
  validate: validateTensorIR,
});

const functionId = (name: string) => `fn:${name}`;
const tensorId = (fn: TixFunction, name: string) => `tensor:${fn.name}:${name}`;

function* entities(value: TensorIR): Iterable<IREntity> {
  for (const fn of value.functions) {
    yield {
      id: functionId(fn.name),
      kind: 'function',
      attributes: { name: fn.name, anchors: fn.anchors, result: fn.result, returns: fn.returns },
    };
    for (const param of fn.params)
      yield { id: tensorId(fn, param.name), kind: 'parameter', attributes: { ...param } };
    for (const stmt of fn.statements)
      yield { id: tensorId(fn, stmt.name), kind: 'statement', attributes: { ...stmt } };
  }
}

function* relations(value: TensorIR): Iterable<IRRelation> {
  for (const fn of value.functions) {
    const members = [...fn.params, ...fn.statements];
    for (const [order, member] of members.entries())
      yield {
        id: `member:${fn.name}:${member.name}`,
        kind: 'member',
        category: 'containment',
        from: functionId(fn.name),
        to: tensorId(fn, member.name),
        order,
      };
    for (const stmt of fn.statements) {
      const used = new Set<string>();
      visitExpr(stmt.expr, expr => {
        if (expr.kind === 'ref') used.add(expr.tensor);
      });
      for (const producer of used)
        yield {
          id: `use:${fn.name}:${producer}:${stmt.name}`,
          kind: 'use',
          category: 'dependency',
          from: tensorId(fn, producer),
          to: tensorId(fn, stmt.name),
        };
    }
  }
}

export const tensorAdapter = defineAdapter<TensorIR>({
  id: TensorProgramIR.id,
  version: TensorProgramIR.version,
  kind: TensorProgramIR.id,
  schemaVersion: TensorProgramIR.version,
  description: 'Projection of function and tensor definitions with their uses',
  relationKinds: { member: 'containment', use: 'dependency' },
  validate: validateTensorIR,
  entities,
  relations,
  roots: value => value.functions.map(fn => functionId(fn.name)),
  resolve(value, id) {
    for (const entity of entities(value)) if (entity.id === id) return entity;
  },
  describe(_value, id) {
    return { label: id };
  },
});

export const tensorArtifact = (value: TensorIR) => createIRArtifact(tensorAdapter, 'tix', value);
