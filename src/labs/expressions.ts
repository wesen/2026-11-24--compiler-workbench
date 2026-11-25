/** Native expression arena: operation records are keyed by their stable symbol, not graph nodes. */
import { assert } from '../framework/core/types.js';
import { canonical } from '../framework/core/data.js';
import { defineIR } from '../framework/contracts/index.js';
import { defineAdapter } from '../framework/ir/index.js';
import type { IRGraph, IREntity } from '../framework/ir/types.js';
import {
  array,
  closedGraph,
  edge,
  entity,
  fields,
  jsonDeserialize,
  number,
  object,
  ordered,
  root,
  text,
} from './common.js';
export type ExpressionNode =
  | {
      op: 'constant';
      value: number;
    }
  | {
      op: 'variable';
      name: string;
    }
  | {
      op: 'add' | 'mul';
      args: [string, string];
    };
export interface ExpressionProgram {
  root: string;
  nodes: Record<string, ExpressionNode>;
}
export const EXPRESSION_ROOT = '$expression';
export function validateExpression(value: unknown): asserts value is ExpressionProgram {
  object(value, 'Expression');
  fields(value, ['root', 'nodes'], 'Expression');
  text(value.root, 'Expression root');
  object(value.nodes, 'Expression arena');
  const ids = Object.keys(value.nodes);
  assert(ids.length > 0 && ids.length <= 10000, 'Expression arena size must be 1..10000');
  assert(!ids.includes(EXPRESSION_ROOT), 'Reserved expression root id');
  for (const [id, n] of Object.entries(value.nodes)) {
    text(id, 'Node id');
    object(n, 'Expression node');
    if (n.op === 'constant') {
      fields(n, ['op', 'value'], 'Constant');
      number(n.value, 'Constant');
    } else if (n.op === 'variable') {
      fields(n, ['op', 'name'], 'Variable');
      text(n.name, 'Variable name');
    } else {
      assert(n.op === 'add' || n.op === 'mul', 'Unknown expression operator');
      fields(n, ['op', 'args'], 'Operation');
      array(n.args, 'Operands');
      assert(n.args.length === 2, 'Binary operation needs exactly two operands');
      for (const a of n.args)
        assert(typeof a === 'string' && Object.hasOwn(value.nodes, a), 'Unknown operand');
    }
  }
  assert(Object.hasOwn(value.nodes, value.root), 'Unknown expression output');
  expressionOrder(value as unknown as ExpressionProgram, ids);
}
export const ExpressionIR = defineIR<ExpressionProgram>({
  id: 'ir-lab.expression',
  version: '1',
  description: 'A native keyed arena of symbolic arithmetic operations',
  validate: validateExpression,
});
export function expressionEntities(v: ExpressionProgram): IREntity[] {
  return [
    entity(EXPRESSION_ROOT, 'expression.program'),
    ...Object.entries(v.nodes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, n]) =>
        entity(
          id,
          `expression.${n.op}`,
          'value' in n ? { value: n.value } : 'name' in n ? { name: n.name } : {},
        ),
      ),
  ];
}
export function expressionRelations(v: ExpressionProgram) {
  return [
    edge('result', 'binding', EXPRESSION_ROOT, v.root),
    ...Object.keys(v.nodes)
      .sort()
      .map(id => edge('contains', 'containment', EXPRESSION_ROOT, id)),
    ...Object.entries(v.nodes).flatMap(([id, n]) =>
      'args' in n ? n.args.map((a, i) => edge('operand', 'dependency', id, a, i)) : [],
    ),
  ];
}
export function rebuildExpression(_base: ExpressionProgram, graph: IRGraph): ExpressionProgram {
  root(graph, EXPRESSION_ROOT, 'expression.program');
  closedGraph(
    graph,
    ['expression.program', 'expression.constant', 'expression.variable', 'expression.add', 'expression.mul'],
    ['contains', 'result', 'operand'],
  );
  const results = graph.relations.filter(r => r.kind === 'result' && r.from === EXPRESSION_ROOT);
  assert(results.length === 1, 'Expression needs one output binding');
  const nodes: Record<string, ExpressionNode> = {};
  for (const e of graph.entities) {
    if (e.id === EXPRESSION_ROOT) continue;
    const op = e.kind.slice('expression.'.length);
    if (op === 'constant')
      nodes[e.id] = {
        op,
        value: e.attributes.value as number,
      };
    else if (op === 'variable')
      nodes[e.id] = {
        op,
        name: e.attributes.name as string,
      };
    else
      nodes[e.id] = {
        op: op as 'add' | 'mul',
        args: ordered(graph, e.id, 'operand').map(r => r.to) as [string, string],
      };
  }
  const result = {
    root: results[0].to,
    nodes,
  };
  validateExpression(result);
  return result;
}
export const expressionAdapter = defineAdapter<ExpressionProgram>({
  id: 'adapter.expression-arena',
  version: '1',
  kind: ExpressionIR.id,
  schemaVersion: ExpressionIR.version,
  description: 'Expose a keyed operation arena through typed containment, binding and dataflow edges',
  relationKinds: {
    contains: 'containment',
    result: 'binding',
    operand: 'dependency',
  },
  entities: expressionEntities,
  resolve(v, id) {
    return expressionEntities(v).find(e => e.id === id);
  },
  relations: expressionRelations,
  roots() {
    return [EXPRESSION_ROOT];
  },
  describe(v, id) {
    const n = v.nodes[id];
    return {
      label: id === EXPRESSION_ROOT ? 'Arithmetic expression' : n ? `${id}: ${n.op}` : id,
      detail: n ? canonical(n) : 'Native keyed operation arena',
    };
  },
  validate: validateExpression,
  rebuild: rebuildExpression,
  operation(v, id) {
    const n = v.nodes[id];
    return n
      ? {
          name: n.op,
          operands: 'args' in n ? n.args : [],
        }
      : undefined;
  },
  serialize: v => JSON.stringify(v, null, 2),
  deserialize: s => jsonDeserialize<ExpressionProgram>(s, validateExpression),
  visualize(v, selection) {
    return {
      kind: 'expression-dag',
      data: {
        root: v.root,
        nodes: v.nodes,
        selection,
      },
    };
  },
});
export function exampleExpression(): ExpressionProgram {
  return {
    root: 'sum',
    nodes: {
      x: {
        op: 'variable',
        name: 'x',
      },
      y: {
        op: 'variable',
        name: 'y',
      },
      square: {
        op: 'mul',
        args: ['x', 'x'],
      },
      squareCopy: {
        op: 'mul',
        args: ['x', 'x'],
      },
      double: {
        op: 'add',
        args: ['y', 'y'],
      },
      pair: {
        op: 'add',
        args: ['square', 'squareCopy'],
      },
      sum: {
        op: 'add',
        args: ['pair', 'double'],
      },
    },
  };
}
/** Iterative postorder avoids consuming the JavaScript call stack on a long arena. */
export function expressionOrder(v: ExpressionProgram, starts: readonly string[] = [v.root]): string[] {
  const result: string[] = [],
    state = new Map<string, 1 | 2>();
  for (const start of starts) {
    if (state.get(start) === 2) continue;
    const stack: {
      id: string;
      exit: boolean;
    }[] = [
      {
        id: start,
        exit: false,
      },
    ];
    while (stack.length) {
      const next = stack.pop()!;
      if (next.exit) {
        state.set(next.id, 2);
        result.push(next.id);
        continue;
      }
      assert(state.get(next.id) !== 1, 'Expression dataflow must be acyclic');
      if (state.get(next.id) === 2) continue;
      state.set(next.id, 1);
      stack.push({
        id: next.id,
        exit: true,
      });
      const n = v.nodes[next.id];
      if ('args' in n)
        for (const id of [...n.args].reverse())
          stack.push({
            id,
            exit: false,
          });
    }
  }
  return result;
}
export function evaluateExpression(v: ExpressionProgram, environment: Record<string, number>): number {
  const cache = new Map<string, number>();
  for (const id of expressionOrder(v)) {
    const n = v.nodes[id],
      result =
        n.op === 'constant'
          ? n.value
          : n.op === 'variable'
            ? environment[n.name]
            : n.op === 'add'
              ? cache.get(n.args[0])! + cache.get(n.args[1])!
              : cache.get(n.args[0])! * cache.get(n.args[1])!;
    assert(Number.isFinite(result), `Expression evaluation of ${id} was not finite`);
    cache.set(id, result);
  }
  return cache.get(v.root)!;
}
/** Exact BigInt coefficients; explicit expansion, degree, and coefficient bounds prevent runaway checks. */
export function expressionPolynomial(v: ExpressionProgram): Record<string, number> {
  const memo = new Map<string, Map<string, bigint>>(),
    coefficientBound = 1n << 256n;
  let operations = 0;
  for (const id of expressionOrder(v)) {
    const n = v.nodes[id];
    let out: Map<string, bigint>;
    const add = (key: string, value: bigint) => {
      assert(++operations <= 100000, 'Polynomial expansion operation budget exhausted');
      const sum = (out.get(key) ?? 0n) + value;
      assert(
        sum < coefficientBound && sum > -coefficientBound,
        'Polynomial coefficient exceeds 256-bit analysis budget',
      );
      if (sum === 0n) out.delete(key);
      else out.set(key, sum);
      assert(out.size <= 10000, 'Polynomial term budget exhausted');
    };
    if (n.op === 'constant') {
      assert(Number.isSafeInteger(n.value), 'Polynomial constants must be safe integers');
      out = new Map(n.value === 0 ? [] : [['', BigInt(n.value)]]);
    } else if (n.op === 'variable') out = new Map([[JSON.stringify([n.name]), 1n]]);
    else {
      const a = memo.get(n.args[0])!,
        b = memo.get(n.args[1])!;
      out = new Map();
      if (n.op === 'add') {
        for (const [k, x] of a) add(k, x);
        for (const [k, x] of b) add(k, x);
      } else
        for (const [ka, x] of a)
          for (const [kb, y] of b) {
            const names: string[] = [...(ka ? JSON.parse(ka) : []), ...(kb ? JSON.parse(kb) : [])];
            assert(names.length <= 256, 'Polynomial degree exceeds analysis budget 256');
            names.sort();
            add(names.length ? JSON.stringify(names) : '', x * y);
          }
    }
    memo.set(id, out);
  }
  const result: Record<string, number> = {};
  for (const [key, value] of [...memo.get(v.root)!].sort(([a], [b]) => a.localeCompare(b))) {
    assert(
      value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER),
      'Final polynomial coefficients must fit safe integers',
    );
    result[key] = Number(value);
  }
  return result;
}
