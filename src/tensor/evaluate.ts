import { plain, value, width, type Axis, type Expr, type Fn, type Op } from './model.js';
export interface BufferValue {
  shape: number[];
  data: Float32Array | Float64Array;
}
export type Inputs = Record<string, BufferValue>;
export type Precision = 'f32' | 'f64';
export const size = (shape: number[]) => shape.reduce((a, b) => a * b, 1);
const operations: Record<Op, (a: number, b: number) => number> = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  neg: a => -a,
  exp: Math.exp,
  log: Math.log,
  sqrt: Math.sqrt,
  tanh: Math.tanh,
  max: Math.max,
  min: Math.min,
};
export class OutsideSample extends Error {}
// Limits apply only when selecting the contract's cases.
export function evaluate(fn: Fn, inputs: Inputs, precision: Precision, sampling = false): BufferValue {
  const ArrayType = precision === 'f32' ? Float32Array : Float64Array;
  const round = precision === 'f32' ? Math.fround : (x: number) => x;
  const shapes = new Map<string, number>(),
    indices = new Map<string, number>(),
    tensors = new Map<string, BufferValue>();
  let work = 0;
  function tick() {
    if (sampling && ++work > 1e6) throw new OutsideSample('Sample work limit');
  }
  for (const p of fn.params) {
    const input = inputs[p.name];
    p.shape.forEach((a, i) => {
      const n = plain(a);
      if (n) shapes.set(n, input.shape[i]);
    });
    tensors.set(p.name, { shape: input.shape, data: ArrayType.from(input.data) });
  }
  function loop(axes: Axis[], i: number, body: () => void) {
    if (i === axes.length) {
      body();
      return;
    }
    const { id, extent } = axes[i],
      dim = value(extent.dim, shapes);
    const n =
      extent.kind === 'blocks'
        ? Math[extent.rounding](dim / width)
        : extent.kind === 'tail'
          ? Math.min(width, dim - width * indices.get(extent.block)!)
          : dim;
    for (let j = 0; j < n; j++) {
      tick();
      indices.set(id, j);
      loop(axes, i + 1, body);
    }
  }
  function scalar(e: Expr): number {
    tick();
    switch (e.kind) {
      case 'literal':
        return round(Number(e.text));
      case 'shape':
        return round(shapes.get(e.name)!);
      case 'load': {
        const t = tensors.get(e.name)!;
        let offset = 0;
        for (let i = 0; i < e.indices.length; i++) {
          const ix = value(e.indices[i], indices);
          if (sampling && (ix < 0 || ix >= t.shape[i]))
            throw new OutsideSample('Sample outside address domain');
          offset = offset * t.shape[i] + ix;
        }
        return t.data[offset];
      }
      case 'op':
        return round(operations[e.op](scalar(e.args[0]), e.args.length === 2 ? scalar(e.args[1]) : 0));
      case 'reduce': {
        let acc = e.op === 'sum' ? 0 : -Infinity;
        loop(e.axes, 0, () => {
          const x = scalar(e.body);
          acc = round(e.op === 'sum' ? acc + x : Math.max(acc, x));
        });
        return acc;
      }
    }
  }
  for (const s of fn.statements) {
    const shape = s.shape.map(a => value(a, shapes));
    if (sampling && (shape.some(n => n < 0) || size(shape) > 4096))
      throw new OutsideSample('Sample shape limit');
    const data = new ArrayType(size(shape));
    let offset = 0;
    loop(s.axes, 0, () => {
      data[offset++] = scalar(s.expr);
    });
    tensors.set(s.name, { shape, data });
  }
  return tensors.get(fn.result)!;
}
