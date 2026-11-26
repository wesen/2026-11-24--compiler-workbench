import { defineIR } from '../framework/contracts/index.js';
import { defineAdapter } from '../framework/ir/index.js';
import type { IREntity, IRRelation } from '../framework/ir/index.js';
import { children, equalShape } from './model.js';
import type { Affine, Binder, Expression, TensorFunction, TensorModule } from './model.js';

function requireIR(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid tensor IR: ${message}`);
}

function validateAffine(value: Affine, names: ReadonlySet<string>): void {
  requireIR(Number.isSafeInteger(value.constant) && Array.isArray(value.terms), 'invalid affine form');
  let previous = '';
  for (const { name, coefficient } of value.terms) {
    requireIR(names.has(name) && previous < name, `unexpected affine name '${name}'`);
    requireIR(Number.isSafeInteger(coefficient) && coefficient !== 0, 'invalid affine coefficient');
    previous = name;
  }
}

function validateFunction(fn: TensorFunction): void {
  requireIR(
    fn.name && Array.isArray(fn.parameters) && fn.parameters.length,
    'missing function or parameters',
  );
  const names = new Set(fn.witnesses.map(w => w.name));
  const bound = new Set<string>();
  for (const { name, parameter, axis } of fn.witnesses) {
    const dimension: Affine | undefined = fn.parameters[parameter]?.shape[axis];
    requireIR(dimension && !bound.has(name), 'invalid shape binding witness');
    const unknown = dimension.terms.filter(term => !bound.has(term.name));
    requireIR(unknown.length === 1 && unknown[0].name === name, 'invalid shape binding order');
    bound.add(name);
  }

  const shapes = new Map<string, readonly Affine[]>();
  function tensor(name: string, shape: readonly Affine[]) {
    requireIR(name && !shapes.has(name) && shape.length > 0, 'invalid tensor declaration');
    for (const axis of shape) validateAffine(axis, names);
    shapes.set(name, shape);
  }

  function extend(scope: ReadonlySet<string>, binders: readonly Binder[]): Set<string> {
    requireIR(binders.length > 0, 'empty binder list');
    const result = new Set(scope);
    for (const { id, extent } of binders) {
      requireIR(typeof id === 'string' && id && !result.has(id), 'duplicate or missing index ID');
      validateAffine(extent, names);
      result.add(id);
    }
    return result;
  }

  function expression(expr: Expression, scope: ReadonlySet<string>): void {
    switch (expr.kind) {
      case 'literal':
        requireIR(
          typeof expr.spelling === 'string' && Number.isFinite(Number(expr.spelling)),
          'invalid literal',
        );
        return;
      case 'shape':
        requireIR(names.has(expr.name), 'unbound shape value');
        return;
      case 'read': {
        const shape = shapes.get(expr.tensor);
        requireIR(shape && expr.indices.length === shape.length, `invalid read of '${expr.tensor}'`);
        for (const index of expr.indices) validateAffine(index, scope);
        return;
      }
      case 'reduce':
        requireIR(expr.op === 'sum' || expr.op === 'max', 'invalid reduction');
        expression(expr.body, extend(scope, expr.indices));
        return;
      case 'blocked-sum':
        requireIR(Number.isSafeInteger(expr.blockSize) && expr.blockSize > 0, 'invalid block size');
        expression(expr.body, extend(scope, [expr.index]));
        return;
      case 'negate':
        break;
      case 'binary':
        requireIR(['+', '-', '*', '/'].includes(expr.op), 'invalid binary operator');
        break;
      case 'call':
        requireIR(
          ['exp', 'log', 'sqrt', 'tanh', 'max', 'min'].includes(expr.op) &&
            expr.args.length === (expr.op === 'min' || expr.op === 'max' ? 2 : 1),
          'invalid intrinsic',
        );
        break;
      default:
        requireIR(false, 'unknown expression');
    }
    for (const child of children(expr)) expression(child, scope);
  }

  for (const param of fn.parameters) tensor(param.name, param.shape);
  let order = -1;
  for (const stmt of fn.statements) {
    requireIR(Number.isSafeInteger(stmt.order) && stmt.order > order, 'invalid statement order');
    order = stmt.order;
    expression(stmt.body, extend(new Set(), stmt.indices));
    tensor(
      stmt.name,
      stmt.indices.map(binder => binder.extent),
    );
  }
  const result = shapes.get(fn.returns);
  requireIR(result && equalShape(result, fn.result), 'invalid return tensor');
}

function validate(value: unknown): void {
  const module = value as TensorModule;
  requireIR(Array.isArray(module?.functions) && module.functions.length, 'missing functions');
  const names = new Set<string>();
  for (const fn of module.functions) {
    validateFunction(fn);
    requireIR(!names.has(fn.name), `duplicate function '${fn.name}'`);
    names.add(fn.name);
  }
}

export const tensorIR = defineIR<TensorModule>({
  id: 'tensor.module',
  version: '1',
  description: 'Ordered indexed tensor definitions',
  validate,
});

const functionId = (fn: TensorFunction) => `fn:${fn.name}`;
const returnId = (fn: TensorFunction) => `${functionId(fn)}/return`;
const tensorId = (fn: TensorFunction, name: string) => `${functionId(fn)}/tensor:${name}`;

function entities(value: TensorModule): IREntity[] {
  return value.functions.flatMap(fn => {
    const { name, result, witnesses } = fn;
    return [
      { id: functionId(fn), kind: 'function', attributes: { name, result, witnesses } },
      ...fn.parameters.map((param, order) => ({
        id: tensorId(fn, param.name),
        kind: 'parameter',
        attributes: { ...param, order },
      })),
      ...fn.statements.map(stmt => ({
        id: tensorId(fn, stmt.name),
        kind: 'statement',
        attributes: { ...stmt },
      })),
      { id: returnId(fn), kind: 'return', attributes: {} },
    ];
  });
}

export function readTensors(expr: Expression, reads: string[]): void {
  if (expr.kind === 'read') reads.push(expr.tensor);
  for (const child of children(expr)) readTensors(child, reads);
}

function relates(kind: 'contains' | 'reads' | 'returns', from: string, to: string): IRRelation {
  return { id: `${kind}:${from}>${to}`, kind, category: relationKinds[kind], from, to };
}

function relations(value: TensorModule): IRRelation[] {
  return value.functions.flatMap(fn => {
    const from = functionId(fn);
    const result = [
      relates('contains', from, returnId(fn)),
      relates('returns', returnId(fn), tensorId(fn, fn.returns)),
    ];
    for (const tensor of [...fn.parameters, ...fn.statements])
      result.push(relates('contains', from, tensorId(fn, tensor.name)));
    for (const stmt of fn.statements) {
      const reads: string[] = [];
      readTensors(stmt.body, reads);
      for (const name of new Set(reads))
        result.push(relates('reads', tensorId(fn, stmt.name), tensorId(fn, name)));
    }
    return result;
  });
}

const relationKinds = { contains: 'containment', reads: 'dependency', returns: 'binding' } as const;
export const tensorAdapter = defineAdapter<TensorModule>({
  id: 'tensor.indexed',
  version: '1',
  kind: tensorIR.id,
  schemaVersion: tensorIR.version,
  description: 'Tix function signatures, ordered statements and tensor references',
  relationKinds,
  validate,
  entities,
  relations,
  resolve: (value, id) => entities(value).find(entity => entity.id === id),
  describe: (_value, id) => ({ label: id }),
});
