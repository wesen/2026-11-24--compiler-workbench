import { definePass } from '../framework/passes/index.js';
import { readTensors, tensorAdapter, tensorIR } from './ir.js';
import { add, AffineRangeError, BLOCK_SIZE, children, constant, mapChildren } from './model.js';
import type { Affine, Expression, TensorFunction, TensorModule } from './model.js';

function pointwise(expr: Expression): boolean {
  return expr.kind !== 'reduce' && expr.kind !== 'blocked-sum' && children(expr).every(pointwise);
}

function substitute(expr: Expression, indices: ReadonlyMap<string, Affine>): Expression {
  if (expr.kind === 'read') {
    return {
      ...expr,
      indices: expr.indices.map(axis =>
        axis.terms.reduce(
          (result, term) => add(result, indices.get(term.name)!, term.coefficient),
          constant(axis.constant),
        ),
      ),
    };
  }
  return mapChildren(expr, child => substitute(child, indices));
}

function inlineFunction(fn: TensorFunction): TensorFunction {
  let statements = fn.statements;
  const unrepresentable = new Set<string>();
  while (true) {
    const counts = new Map<string, number>();
    for (const stmt of statements) {
      const reads: string[] = [];
      readTensors(stmt.body, reads);
      for (const read of reads) counts.set(read, (counts.get(read) ?? 0) + 1);
    }
    const producer = statements.find(
      stmt =>
        stmt.name !== fn.returns &&
        !unrepresentable.has(stmt.name) &&
        counts.get(stmt.name) === 1 &&
        pointwise(stmt.body),
    );
    if (!producer) return statements === fn.statements ? fn : { ...fn, statements };

    const rewrite = (expr: Expression): Expression => {
      if (expr.kind === 'read' && expr.tensor === producer.name) {
        const indices = new Map(producer.indices.map((binder, i) => [binder.id, expr.indices[i]]));
        return substitute(producer.body, indices);
      }
      return mapChildren(expr, rewrite);
    };

    try {
      statements = statements
        .filter(stmt => stmt !== producer)
        .map(stmt => ({ ...stmt, body: rewrite(stmt.body) }));
    } catch (error) {
      if (!(error instanceof AffineRangeError)) throw error;
      unrepresentable.add(producer.name);
    }
  }
}

export const inline = definePass<TensorModule>({
  id: 'tensor.inline',
  version: '1',
  description: 'Substitute a pointwise tensor at its single read',
  ir: tensorIR,
  adapter: tensorAdapter,
  writes: { entities: ['statement'], relations: ['contains', 'reads'] },
  run({ before }) {
    const functions = before.value.functions.map(inlineFunction);
    if (functions.some((fn, i) => fn !== before.value.functions[i])) return { native: { functions } };
  },
});

export const splitSum = definePass<TensorModule>({
  id: 'tensor.split-sum',
  version: '1',
  description: 'Group a single-index sum into ordered blocks of four',
  ir: tensorIR,
  adapter: tensorAdapter,
  writes: { entities: ['statement'], relations: [] },
  run({ before }) {
    let changed = false;
    function rewrite(expr: Expression): Expression {
      if (expr.kind === 'reduce' && expr.op === 'sum' && expr.indices.length === 1) {
        changed = true;
        return {
          kind: 'blocked-sum',
          index: expr.indices[0],
          blockSize: BLOCK_SIZE,
          body: rewrite(expr.body),
        };
      }
      return mapChildren(expr, rewrite);
    }
    const functions = before.value.functions.map(fn => ({
      ...fn,
      statements: fn.statements.map(stmt => ({ ...stmt, body: rewrite(stmt.body) })),
    }));
    if (changed) return { native: { functions } };
  },
});
