import { definePass } from '../framework/passes/index.js';
import { adapter, TixIR } from './ir.js';
import {
  add,
  mapExpr,
  substitute,
  variable,
  visit,
  width,
  type Affine,
  type Expr,
  type Fn,
  type Module,
} from './model.js';

function replaceIndices(expr: Expr, bindings: Map<string, Affine>): Expr {
  return mapExpr(expr, e =>
    e.kind === 'load' ? { ...e, indices: e.indices.map(a => substitute(a, bindings)) } : e,
  );
}
function inline(fn: Fn): Fn {
  const statements = [...fn.statements];
  for (let i = 0; i < statements.length; i++) {
    const p = statements[i];
    if (p.name === fn.result) continue;
    let pointwise = true;
    visit(p.expr, e => {
      if (e.kind === 'reduce') pointwise = false;
    });
    if (!pointwise) continue;
    let uses = 0,
      consumer = -1;
    for (let j = i + 1; j < statements.length; j++)
      visit(statements[j].expr, e => {
        if (e.kind === 'load' && e.name === p.name) {
          uses++;
          consumer = j;
        }
      });
    if (uses !== 1) continue;
    const s = statements[consumer];
    statements[consumer] = {
      ...s,
      expr: mapExpr(s.expr, e => {
        if (e.kind !== 'load' || e.name !== p.name) return e;
        return replaceIndices(p.expr, new Map(p.axes.map((a, k) => [a.id, e.indices[k]])));
      }),
    };
    statements.splice(i--, 1);
  }
  return { ...fn, statements };
}
function split(fn: Fn): Fn {
  return {
    ...fn,
    statements: fn.statements.map(s => ({
      ...s,
      expr: mapExpr(s.expr, e => {
        if (e.kind !== 'reduce' || e.op !== 'sum' || e.axes.length !== 1) return e;
        const [{ id, extent }] = e.axes;
        if (extent.kind !== 'dim') return e;
        const { dim } = extent,
          block = id + '/block',
          lane = id + '/lane';
        const address = add(variable(lane), variable(block), width);
        const body = replaceIndices(e.body, new Map([[id, address]]));
        return {
          kind: 'reduce',
          op: 'sum',
          axes: [{ id: block, extent: { kind: 'blocks', dim, rounding: 'ceil' } }],
          body: {
            kind: 'reduce',
            op: 'sum',
            axes: [{ id: lane, extent: { kind: 'tail', dim, block } }],
            body,
          },
        };
      }),
    })),
  };
}
function pass(name: string, transform: (fn: Fn) => Fn) {
  return definePass<Module>({
    id: 'tensor.' + name,
    version: '1',
    description: name,
    ir: TixIR,
    adapter,
    writes: { entities: ['tensor'], relations: ['reads', 'contains'] },
    run: ({ before }) => ({ native: { functions: before.value.functions.map(transform) } }),
  });
}
export const inlinePass = pass('inline', inline),
  splitPass = pass('split-sum', split);
