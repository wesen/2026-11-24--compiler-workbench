import { definePass } from '../framework/passes/index.js';
import { TensorType, tensorAdapter, UnprovedAccess, validateFunction } from './ir.js';
import { expressions, substituteAffine } from './model.js';
import type { Expr, Statement, TensorFunction } from './model.js';

function mapExpression(expr: Expr, visit: (node: Expr) => Expr): Expr {
  switch (expr.kind) {
    case 'unary':
      return visit({ ...expr, arg: mapExpression(expr.arg, visit) });
    case 'binary':
      return visit({
        ...expr,
        left: mapExpression(expr.left, visit),
        right: mapExpression(expr.right, visit),
      });
    case 'reduce':
      return visit({ ...expr, body: mapExpression(expr.body, visit) });
    default:
      return visit(expr);
  }
}

function inlineStatements(fn: TensorFunction): Statement[] | undefined {
  let statements = [...fn.statements];
  let changed = false;
  let i = 0;
  while (i < statements.length) {
    const producer = statements[i];
    if (
      fn.result === producer.name ||
      Array.from(expressions(producer.body)).some(node => node.kind === 'reduce')
    ) {
      i++;
      continue;
    }
    const consumers = statements.slice(i + 1).flatMap(stmt =>
      Array.from(expressions(stmt.body))
        .filter(node => node.kind === 'read' && node.tensor === producer.name)
        .map(() => stmt),
    );
    if (consumers.length !== 1) {
      i++;
      continue;
    }

    const consumer = consumers[0];
    const body = mapExpression(consumer.body, node => {
      if (node.kind !== 'read' || node.tensor !== producer.name) return node;
      const coordinates = new Map(producer.binders.map((binder, axis) => [binder.id, node.coords[axis]]));
      return mapExpression(producer.body, part =>
        part.kind === 'read'
          ? {
              ...part,
              coords: part.coords.map(coord => substituteAffine(coord, name => coordinates.get(name)!)),
            }
          : part,
      );
    });
    const candidate = [...statements];
    candidate[statements.indexOf(consumer)] = { ...consumer, body };
    candidate.splice(i, 1);
    try {
      validateFunction({ ...fn, statements: candidate });
    } catch (error) {
      if (!(error instanceof UnprovedAccess)) throw error;
      i++;
      continue;
    }
    statements = candidate;
    changed = true;
  }
  return changed ? statements : undefined;
}

const inline = definePass({
  id: 'tensor.inline',
  version: '1',
  description: 'Inline single-use pointwise tensor definitions',
  ir: TensorType,
  adapter: tensorAdapter,
  writes: { entities: ['statement'], relations: ['contains', 'reads', 'next'] },
  run({ before }) {
    let changed = false;
    const functions = before.value.functions.map(fn => {
      const statements = inlineStatements(fn);
      if (!statements) return fn;
      changed = true;
      return { ...fn, statements };
    });
    if (changed) return { native: { functions } };
  },
});

const blockSize = 4;

const splitSum = definePass({
  id: 'tensor.split-sum',
  version: '1',
  description: 'Split single-index sums into consecutive blocks',
  ir: TensorType,
  adapter: tensorAdapter,
  writes: { entities: ['statement'], relations: [] },
  run({ before }) {
    let changed = false;
    const functions = before.value.functions.map(fn => ({
      ...fn,
      statements: fn.statements.map(stmt => ({
        ...stmt,
        body: mapExpression(stmt.body, node => {
          if (
            node.kind !== 'reduce' ||
            node.op !== 'sum' ||
            node.binders.length !== 1 ||
            node.block !== undefined
          )
            return node;
          const { extent } = node.binders[0];
          if (!extent.terms.length && BigInt(extent.constant) <= BigInt(blockSize)) return node;
          changed = true;
          return { ...node, block: blockSize };
        }),
      })),
    }));
    if (changed) return { native: { functions } };
  },
});

export const tensorPasses = new Map([
  ['inline', inline],
  ['split-sum', splitSum],
]);
