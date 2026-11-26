import { plain, value } from './model.js';
import type { Affine, Axis, Binary, Bindings, Expr, Fn, Unary } from './model.js';

export type Tensor = { shape: number[]; data: Float32Array | Float64Array };
export type Inputs = Record<string, Tensor>;
export type Precision = 'f32' | 'f64';
const unary: Record<Unary, (x: number) => number> = {
  '-': x => -x,
  exp: Math.exp,
  log: Math.log,
  sqrt: Math.sqrt,
  tanh: Math.tanh,
};
const binary: Record<Binary, (x: number, y: number) => number> = {
  '+': (x, y) => x + y,
  '-': (x, y) => x - y,
  '*': (x, y) => x * y,
  '/': (x, y) => x / y,
  min: Math.min,
  max: Math.max,
};
export const volume = (shape: number[]) => shape.reduce((n, d) => n * d, 1);
export function evaluate(fn: Fn, inputs: Inputs, precision: Precision): Tensor {
  const round = precision === 'f32' ? Math.fround : Number;
  const Buffer = precision === 'f32' ? Float32Array : Float64Array;
  const shapes: Bindings = new Map(),
    coords: Bindings = new Map();
  const tensors = new Map<string, { tensor: Tensor; strides: number[] }>();
  function store(name: string, tensor: Tensor) {
    let stride = 1;
    const strides = tensor.shape.map(() => 0);
    for (let i = strides.length - 1; i >= 0; i--) {
      strides[i] = stride;
      stride *= tensor.shape[i];
    }
    tensors.set(name, { tensor, strides });
  }
  for (const p of fn.params) {
    const input = inputs[p.name];
    p.shape.forEach((a, i) => {
      const n = plain(a);
      if (n !== undefined) shapes.set(n, input.shape[i]);
    });
    store(p.name, { shape: [...input.shape], data: new Buffer(input.data) });
  }
  const dims = new Map<Affine, number>();
  function extent(d: Affine) {
    let n = dims.get(d);
    if (n === undefined) {
      n = value(d, shapes);
      dims.set(d, n);
    }
    return n;
  }
  function loop(axes: Axis[], body: () => void, depth = 0): void {
    if (depth === axes.length) {
      body();
      return;
    }
    const axis = axes[depth],
      n = extent(axis.extent);
    for (let i = 0; i < n; i++) {
      coords.set(axis.id, i);
      loop(axes, body, depth + 1);
    }
  }
  function scalar(e: Expr): number {
    switch (e.kind) {
      case 'literal':
        return round(Number(e.value));
      case 'shape':
        return round(shapes.get(e.name)!);
      case 'load': {
        const { tensor, strides } = tensors.get(e.tensor)!;
        const offset = e.indices.reduce((acc, idx, i) => acc + value(idx, coords) * strides[i], 0);
        return tensor.data[offset];
      }
      case 'unary':
        return round(unary[e.op](scalar(e.arg)));
      case 'binary':
        return round(binary[e.op](scalar(e.left), scalar(e.right)));
      case 'reduce': {
        const max = e.op === 'max';
        let acc = max ? -Infinity : 0;
        loop(e.axes, () => {
          const x = scalar(e.body);
          acc = round(max ? Math.max(acc, x) : acc + x);
        });
        return acc;
      }
      case 'blocked': {
        const axis = e.axes[0],
          n = extent(axis.extent);
        let total = 0;
        for (let start = 0; start < n; start += e.size) {
          let partial = 0;
          for (let k = start; k < Math.min(start + e.size, n); k++) {
            coords.set(axis.id, k);
            partial = round(partial + scalar(e.body));
          }
          total = round(total + partial);
        }
        return total;
      }
    }
  }
  for (const s of fn.statements) {
    const shape = s.axes.map(a => extent(a.extent)),
      data = new Buffer(volume(shape));
    let offset = 0;
    loop(s.axes, () => {
      data[offset++] = scalar(s.expr);
    });
    store(s.name, { shape, data });
  }
  return tensors.get(fn.result)!.tensor;
}
