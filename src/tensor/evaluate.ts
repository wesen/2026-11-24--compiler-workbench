import { affineValue, children, dimensions, InvalidExtent, safeInteger } from './model.js';
import type { Affine, Expression, TensorFunction } from './model.js';

export type Precision = 'f32' | 'f64';
export interface TensorInput {
  shape: number[];
  data: Float32Array | Float64Array;
}
export type TensorInputs = Record<string, TensorInput>;

export class EvaluationLimit extends Error {}

export function elementCount(shape: readonly number[]): number {
  if (shape.includes(0)) return 0;
  let count = 1;
  for (const axis of shape) {
    count *= axis;
    if (!Number.isSafeInteger(count))
      throw new InvalidExtent('tensor element count is outside the safe integer range');
  }
  return count;
}

function bindShapes(fn: TensorFunction, inputs: TensorInputs): Map<string, number> {
  const actual = fn.parameters.map(param => {
    const input = Object.hasOwn(inputs, param.name) ? inputs[param.name] : undefined;
    if (!input || !Array.isArray(input.shape) || input.shape.length !== param.shape.length)
      throw new Error(`input '${param.name}' needs rank ${param.shape.length}`);
    if (input.shape.some(axis => !Number.isSafeInteger(axis) || axis < 0))
      throw new Error(`input '${param.name}' has an invalid extent`);
    if (!(input.data instanceof Float32Array || input.data instanceof Float64Array))
      throw new Error(`input '${param.name}' needs floating-point typed array data`);
    if (elementCount(input.shape) !== input.data.length)
      throw new Error(`input '${param.name}' has the wrong element count`);
    return input.shape;
  });
  const shapes = new Map<string, number>();
  for (const { name, parameter, axis } of fn.witnesses) {
    const affine = fn.parameters[parameter].shape[axis];
    const coefficient = BigInt(affine.terms.find(term => term.name === name)!.coefficient);
    shapes.set(name, 0);
    const difference = BigInt(actual[parameter][axis]) - affineValue(affine, shapes);
    if (difference % coefficient !== 0n || difference / coefficient < 0n)
      throw new Error(`input shapes cannot bind '${name}' to a nonnegative integer`);
    shapes.set(name, safeInteger(difference / coefficient));
  }
  for (const [i, param] of fn.parameters.entries()) {
    if (!dimensions(param.shape, shapes).every((axis, j) => axis === actual[i][j]))
      throw new Error(`input '${param.name}' has inconsistent shape`);
  }
  return shapes;
}

const call = { exp: Math.exp, log: Math.log, sqrt: Math.sqrt, tanh: Math.tanh, max: Math.max, min: Math.min };

export function evaluate(
  fn: TensorFunction,
  inputs: TensorInputs,
  precision: Precision,
  budget = Infinity,
  tensorLimit = Infinity,
): TensorInput {
  const shapes = bindShapes(fn, inputs);
  const tensors = new Map<string, TensorInput>();
  const ids = new Map<string, number>();
  const ArrayType = precision === 'f32' ? Float32Array : Float64Array;
  const round = precision === 'f32' ? Math.fround : (value: number) => value;
  const tick = () => {
    if (--budget < 0) throw new EvaluationLimit('tensor evaluation exceeded its logical visit budget');
  };

  const extents = new Map<Affine, number>();
  const extent = (axis: Affine) => {
    let value = extents.get(axis);
    if (value === undefined) {
      [value] = dimensions([axis], shapes);
      extents.set(axis, value);
    }
    return value;
  };

  // Resolve every executable dimension, even if an enclosing loop is empty.
  const checkLoopExtents = (expr: Expression): void => {
    if (expr.kind === 'reduce') expr.indices.forEach(binder => extent(binder.extent));
    if (expr.kind === 'blocked-sum') extent(expr.index.extent);
    for (const child of children(expr)) checkLoopExtents(child);
  };

  function loop(names: readonly string[], bounds: readonly number[], visit: () => void): void {
    if (bounds.includes(0)) return;
    const axis = (depth: number): void => {
      if (depth === bounds.length) {
        visit();
        return;
      }
      for (let i = 0; i < bounds[depth]; i++) {
        tick();
        ids.set(names[depth], i);
        axis(depth + 1);
      }
    };
    axis(0);
  }

  function scalar(expr: Expression): number {
    tick();
    switch (expr.kind) {
      case 'literal':
        return round(Number(expr.spelling));
      case 'shape':
        return round(shapes.get(expr.name)!);
      case 'read': {
        const { data, shape } = tensors.get(expr.tensor)!;
        let offset = 0;
        for (const [axis, index] of expr.indices.entries()) {
          const value = safeInteger(affineValue(index, ids));
          if (value < 0 || value >= shape[axis])
            throw new Error(`read outside '${expr.tensor}' at axis ${axis + 1}`);
          offset = offset * shape[axis] + value;
        }
        return data[offset];
      }
      case 'negate':
        return round(-scalar(expr.operand));
      case 'binary': {
        const left = scalar(expr.left);
        const right = scalar(expr.right);
        switch (expr.op) {
          case '+':
            return round(left + right);
          case '-':
            return round(left - right);
          case '*':
            return round(left * right);
          case '/':
            return round(left / right);
        }
      }
      case 'call': {
        const [first, second] = expr.args.map(scalar);
        return round(
          expr.op === 'max' || expr.op === 'min' ? call[expr.op](first, second) : call[expr.op](first),
        );
      }
      case 'reduce': {
        const sum = expr.op === 'sum';
        let total = sum ? 0 : -Infinity;
        loop(
          expr.indices.map(index => index.id),
          expr.indices.map(index => extent(index.extent)),
          () => {
            const value = scalar(expr.body);
            total = round(sum ? total + value : Math.max(total, value));
          },
        );
        return total;
      }
      case 'blocked-sum': {
        let total = 0;
        const size = extent(expr.index.extent);
        for (let start = 0; start < size; ) {
          const end = start + Math.min(expr.blockSize, size - start);
          let partial = 0;
          // Charge the same logical iterations as a sequential sum. Only nonempty blocks reach this loop.
          for (let i = start; i < end; i++) {
            tick();
            ids.set(expr.index.id, i);
            partial = round(partial + scalar(expr.body));
          }
          total = round(total + partial);
          start = end;
        }
        return total;
      }
    }
  }

  for (const param of fn.parameters) {
    const { shape, data } = inputs[param.name];
    for (const value of data)
      if (!Number.isFinite(value)) throw new Error(`input '${param.name}' must be finite`);
    tensors.set(param.name, { shape: [...shape], data: ArrayType.from(data) });
  }
  for (const stmt of fn.statements) {
    const shape = stmt.indices.map(binder => extent(binder.extent));
    checkLoopExtents(stmt.body);
    const count = elementCount(shape);
    if (count > tensorLimit)
      throw new EvaluationLimit(`tensor '${stmt.name}' exceeds ${tensorLimit} elements`);
    const data = new ArrayType(count);
    let offset = 0;
    loop(
      stmt.indices.map(binder => binder.id),
      shape,
      () => {
        data[offset++] = scalar(stmt.body);
      },
    );
    tensors.set(stmt.name, { shape, data });
  }
  return tensors.get(fn.returns)!;
}
