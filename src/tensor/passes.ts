import { definePass } from '../framework/passes/index.js';
import { TensorProgramIR, tensorAdapter } from './ir.js';
import { affineSum, visitExpr, type Expr, type Statement, type TensorIR, type TixFunction } from './model.js';

function transformExpr(expr: Expr, replace: (expr: Expr) => Expr): Expr {
  let next = expr;
  if (expr.kind === 'primitive') {
    const args = expr.args.map(arg => transformExpr(arg, replace));
    if (args.some((arg, index) => arg !== expr.args[index])) next = { ...expr, args };
  } else if (expr.kind === 'reduce' || expr.kind === 'blocked-sum') {
    const body = transformExpr(expr.body, replace);
    if (body !== expr.body) next = { ...expr, body };
  }
  return replace(next);
}

function isPointwise(stmt: Statement): boolean {
  let pointwise = true;
  visitExpr(stmt.expr, expr => {
    if (expr.kind === 'reduce' || expr.kind === 'blocked-sum') pointwise = false;
  });
  return pointwise;
}

function substitute(producer: Statement, use: Extract<Expr, { kind: 'ref' }>): Expr {
  const bindings = new Map(producer.axes.map((axis, index) => [axis.id, use.indices[index]!]));
  return transformExpr(producer.expr, expr => {
    if (expr.kind !== 'ref') return expr;
    return {
      ...expr,
      indices: expr.indices.map(index =>
        affineSum(expr.at, [
          [{ constant: index.constant, terms: [] }, 1],
          ...index.terms.map(([id, factor]) => [bindings.get(id)!, factor] as const),
        ]),
      ),
    };
  });
}

function inline(fn: TixFunction): TixFunction {
  const statements = [...fn.statements];
  let changed = false;
  for (let index = 0; index < statements.length; ) {
    const producer = statements[index]!;
    if (fn.returns === producer.name || !isPointwise(producer)) {
      index++;
      continue;
    }
    let count = 0;
    let consumer = -1;
    for (let later = index + 1; later < statements.length && count < 2; later++) {
      visitExpr(statements[later]!.expr, expr => {
        if (expr.kind === 'ref' && expr.tensor === producer.name) {
          count++;
          consumer = later;
        }
      });
    }
    if (count !== 1) {
      index++;
      continue;
    }
    const statement = statements[consumer]!;
    statements[consumer] = {
      ...statement,
      expr: transformExpr(statement.expr, expr =>
        expr.kind === 'ref' && expr.tensor === producer.name ? substitute(producer, expr) : expr,
      ),
    };
    statements.splice(index, 1);
    changed = true;
  }
  return changed ? { ...fn, statements } : fn;
}

function splitSum(fn: TixFunction): TixFunction {
  const statements = fn.statements.map(stmt => {
    const expr = transformExpr(stmt.expr, node => {
      if (node.kind !== 'reduce' || node.op !== 'sum' || node.axes.length !== 1) return node;
      return { kind: 'blocked-sum', at: node.at, axis: node.axes[0]!, body: node.body, block: 4 };
    });
    return expr === stmt.expr ? stmt : { ...stmt, expr };
  });
  return statements.some((stmt, index) => stmt !== fn.statements[index]) ? { ...fn, statements } : fn;
}

function tensorPass(id: string, description: string, rewrite: (fn: TixFunction) => TixFunction) {
  return definePass<TensorIR>({
    id,
    version: '1',
    description,
    ir: TensorProgramIR,
    adapter: tensorAdapter,
    writes: { entities: ['statement'], relations: ['member', 'use'] },
    run({ before }) {
      const functions = before.value.functions.map(rewrite);
      if (functions.some((fn, index) => fn !== before.value.functions[index]))
        return { native: { functions } };
    },
  });
}

export const inlinePass = tensorPass('inline', 'Inline single-use pointwise tensors', inline);
export const splitSumPass = tensorPass('split-sum', 'Sum consecutive blocks of four terms', splitSum);
