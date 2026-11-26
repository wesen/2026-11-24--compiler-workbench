import { definePass } from '../framework/passes/index.js';
import { adapter, TixIR } from './ir.js';
import type { Expr, Fn, Module } from './model.js';
import { mapExpr, substitute, walk } from './model.js';

function inline(fn: Fn): Fn {
  const statements = [...fn.statements];
  for (let i = 0; i < statements.length; i++) {
    const producer = statements[i];
    if (producer.name === fn.result) continue;
    let pointwise = true;
    walk(producer.expr, e => {
      if (e.kind === 'reduce' || e.kind === 'blocked') pointwise = false;
    });
    if (!pointwise) continue;
    let uses = 0,
      consumer = -1;
    for (let j = i + 1; j < statements.length; j++) {
      walk(statements[j].expr, e => {
        if (e.kind === 'load' && e.tensor === producer.name) {
          uses++;
          consumer = j;
        }
      });
    }
    if (uses !== 1) continue;
    const stmt = statements[consumer];
    const expr = mapExpr(stmt.expr, e => {
      if (e.kind !== 'load' || e.tensor !== producer.name) return e;
      const args = new Map(producer.axes.map((a, i) => [a.id, e.indices[i]]));
      return mapExpr(producer.expr, node =>
        node.kind === 'load' ? { ...node, indices: node.indices.map(a => substitute(a, args)) } : node,
      );
    });
    statements[consumer] = { ...stmt, expr };
    statements.splice(i--, 1);
  }
  return statements.length === fn.statements.length ? fn : { ...fn, statements };
}
function split(fn: Fn): Fn {
  let changed = false;
  const statements = fn.statements.map(s => ({
    ...s,
    expr: mapExpr(s.expr, (e): Expr => {
      if (e.kind !== 'reduce' || e.op !== 'sum' || e.axes.length !== 1) return e;
      changed = true;
      return { kind: 'blocked', size: 2, axes: [e.axes[0]], body: e.body, at: e.at };
    }),
  }));
  return changed ? { ...fn, statements } : fn;
}
function pass(id: string, rewrite: (fn: Fn) => Fn, relations: string[]) {
  return definePass<Module>({
    id: 'tix.' + id,
    version: '1',
    description: id + ' over checked Tix expressions',
    adapter,
    ir: TixIR,
    writes: { entities: ['tix.statement'], relations },
    run({ before }) {
      const functions = before.value.functions.map(rewrite);
      if (functions.some((f, i) => f !== before.value.functions[i])) return { native: { functions } };
    },
  });
}
export const inlinePass = pass('inline', inline, ['contains', 'reads']);
export const splitPass = pass('split-sum', split, []);
