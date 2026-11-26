import { evaluateAffine } from './model.js';
import type { Affine, Binder, Expr, TensorFunction } from './model.js';

export type Precision = 'f32' | 'f64';
export interface Tensor {
  shape: number[];
  data: Float32Array | Float64Array;
}
export type Inputs = Readonly<Record<string, Tensor>>;
type Bindings = ReadonlyMap<string, bigint>;

export function bindShapes(fn: TensorFunction, shapes: ReadonlyMap<string, readonly number[]>): Bindings {
  const values = new Map<string, bigint>();
  for (const { name, shape } of fn.params) {
    const actual = shapes.get(name);
    if (!actual || actual.length !== shape.length || actual.some(n => !Number.isSafeInteger(n) || n < 0))
      throw new Error(`Invalid shape for input '${name}'`);
    shape.forEach((dim, axis) => {
      if (dim.terms.length !== 1) return;
      const [symbol, factor] = dim.terms[0];
      const numerator = BigInt(actual[axis]) - BigInt(dim.constant);
      const denominator = BigInt(factor);
      const value = numerator / denominator;
      if (
        numerator % denominator !== 0n ||
        value < 0n ||
        (values.has(symbol) && values.get(symbol) !== value)
      )
        throw new Error(`Inconsistent binding for shape '${symbol}'`);
      values.set(symbol, value);
    });
  }
  for (const { name, shape } of fn.params) {
    const actual = shapes.get(name)!;
    if (
      shape.some((dim, axis) => evaluateAffine(dim, symbol => values.get(symbol)!) !== BigInt(actual[axis]))
    )
      throw new Error(`Inconsistent shape for input '${name}'`);
  }
  return values;
}

export function extentOf(extent: Affine, shapes: Bindings): number {
  const n = Number(evaluateAffine(extent, name => shapes.get(name)!));
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid concrete extent');
  return n;
}

export function elementCount(shape: readonly number[]): number {
  return shape.includes(0) ? 0 : shape.reduce((n, dim) => n * dim, 1);
}

const identity = (value: number) => value;
type Buffer = { tensor: Tensor; words?: Uint32Array };

function storage(shape: number[], precision: Precision): Buffer {
  const count = elementCount(shape);
  if (precision === 'f64') return { tensor: { shape, data: new Float64Array(count) } };
  const data = new Float32Array(count);
  return { tensor: { shape, data }, words: new Uint32Array(data.buffer) };
}

function write(buffer: Buffer, i: number, value: number) {
  if (buffer.words && Number.isNaN(value)) buffer.words[i] = 0x7fc00000;
  else buffer.tensor.data[i] = value;
}

export function evaluate(fn: TensorFunction, inputs: Inputs, precision: Precision): Tensor {
  const round = precision === 'f32' ? Math.fround : identity;
  const shapes = bindShapes(
    fn,
    new Map(Object.entries(inputs).map(([name, tensor]) => [name, tensor.shape])),
  );
  const tensors = new Map<string, Tensor>();
  for (const { name } of fn.params) {
    const input = inputs[name];
    if (input.data.length !== elementCount(input.shape)) throw new Error(`Invalid data length for '${name}'`);
    const buffer = storage(input.shape.slice(), precision);
    for (let i = 0; i < input.data.length; i++) write(buffer, i, round(input.data[i]));
    tensors.set(name, buffer.tensor);
  }

  const indices = new Map<string, number>();
  const extents = new WeakMap<Binder, number>();
  function bound(binder: Binder): number {
    let n = extents.get(binder);
    if (n === undefined) {
      n = extentOf(binder.extent, shapes);
      extents.set(binder, n);
    }
    return n;
  }

  function iterate(binders: readonly Binder[], visit: () => void, depth = 0): void {
    if (depth === binders.length) {
      visit();
      return;
    }
    const binder = binders[depth];
    const extent = bound(binder);
    for (let i = 0; i < extent; i++) {
      indices.set(binder.id, i);
      iterate(binders, visit, depth + 1);
    }
  }

  function scalar(node: Expr): number {
    switch (node.kind) {
      case 'literal':
        return round(Number(node.text));
      case 'shape':
        return round(Number(shapes.get(node.name)!));
      case 'read': {
        const tensor = tensors.get(node.tensor)!;
        let offset = 0;
        for (let axis = 0; axis < node.coords.length; axis++) {
          const { constant, terms } = node.coords[axis];
          const coord =
            constant === '0' && terms.length === 1 && terms[0][1] === '1'
              ? indices.get(terms[0][0])!
              : Number(evaluateAffine(node.coords[axis], name => BigInt(indices.get(name)!)));
          offset = offset * tensor.shape[axis] + coord;
        }
        return tensor.data[offset];
      }
      case 'unary': {
        const n = scalar(node.arg);
        return round(node.op === '-' ? -n : Math[node.op](n));
      }
      case 'binary': {
        const a = scalar(node.left);
        const b = scalar(node.right);
        switch (node.op) {
          case '+':
            return round(a + b);
          case '-':
            return round(a - b);
          case '*':
            return round(a * b);
          case '/':
            return round(a / b);
          case 'max':
            return round(Math.max(a, b));
          case 'min':
            return round(Math.min(a, b));
        }
      }
      case 'reduce': {
        if (node.block !== undefined) {
          const binder = node.binders[0];
          const extent = bound(binder);
          let total = 0;
          for (let start = 0; start < extent; start += node.block) {
            let partial = 0;
            const end = Math.min(extent, start + node.block);
            for (let i = start; i < end; i++) {
              indices.set(binder.id, i);
              partial = round(partial + scalar(node.body));
            }
            total = round(total + partial);
          }
          return total;
        }
        let acc = node.op === 'sum' ? 0 : -Infinity;
        if (node.binders.some(binder => bound(binder) === 0)) return acc;
        iterate(node.binders, () => {
          const n = scalar(node.body);
          acc = round(node.op === 'sum' ? acc + n : Math.max(acc, n));
        });
        return acc;
      }
    }
  }

  for (const stmt of fn.statements) {
    const buffer = storage(stmt.binders.map(bound), precision);
    let offset = 0;
    if (buffer.tensor.data.length) iterate(stmt.binders, () => write(buffer, offset++, scalar(stmt.body)));
    tensors.set(stmt.name, buffer.tensor);
  }
  return tensors.get(fn.result)!;
}
