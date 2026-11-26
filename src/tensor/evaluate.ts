import { fail, plain, value, type Axis, type Expr, type Fn } from './model.js';
export interface Tensor {
  shape: number[];
  data: Float32Array | Float64Array;
}
export type Inputs = Record<string, Tensor>;
export type Precision = 'f32' | 'f64';
export const product = (xs: number[]) => xs.reduce((a, b) => a * b, 1);
function calc(fn: string, a: number, b: number) {
  switch (fn) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return a / b;
    case 'neg':
      return -a;
    case 'max':
      return Math.max(a, b);
    case 'min':
      return Math.min(a, b);
    case 'exp':
      return Math.exp(a);
    case 'log':
      return Math.log(a);
    case 'sqrt':
      return Math.sqrt(a);
    case 'tanh':
      return Math.tanh(a);
    default:
      throw Error('invalid op: ' + fn);
  }
}
export function evaluate(f: Fn, inputs: Inputs, precision: Precision): Tensor {
  const A = precision === 'f32' ? Float32Array : Float64Array,
    round = precision === 'f32' ? Math.fround : (x: number) => x;
  const shapes = new Map<string, number>(),
    indices = new Map<string, number>(),
    tensors = new Map<string, Tensor>();
  for (const p of f.params) {
    const t = inputs[p.name];
    if (
      !t ||
      t.shape.length !== p.dims.length ||
      !t.shape.every(n => Number.isSafeInteger(n) && n >= 0) ||
      product(t.shape) !== t.data.length
    )
      fail(f.at, 'invalid input ' + p.name);
    p.dims.forEach((d, i) => {
      const n = plain(d);
      if (n) shapes.set(n, t.shape[i]);
    });
  }
  for (const p of f.params) {
    const t = inputs[p.name];
    if (!p.dims.every((d, i) => value(d, shapes) === t.shape[i]) || !t.data.every(Number.isFinite))
      fail(f.at, 'inconsistent input ' + p.name);
    tensors.set(p.name, { shape: [...t.shape], data: new A(t.data) });
  }
  function loops(axes: Axis[], i: number, body: () => void) {
    if (i === axes.length) {
      body();
      return;
    }
    const a = axes[i],
      end = value(a.extent, shapes);
    for (let j = 0; j < end; j++) {
      indices.set(a.id, j);
      loops(axes, i + 1, body);
    }
  }
  function expr(e: Expr): number {
    switch (e.op) {
      case 'num':
        return round(e.v);
      case 'shape':
        return round(shapes.get(e.name)!);
      case 'calc':
        return round(calc(e.fn, expr(e.args[0]), e.args[1] ? expr(e.args[1]) : 0));
      case 'read': {
        const t = tensors.get(e.name)!;
        let off = 0;
        for (let i = 0; i < e.sub.length; i++) off = off * t.shape[i] + value(e.sub[i], indices);
        return t.data[off];
      }
      case 'reduce': {
        let acc = e.fn === 'max' ? -Infinity : 0;
        if (e.fn === 'blocked') {
          const a = e.axes[0],
            end = value(a.extent, shapes);
          for (let start = 0; start < end; start += 4) {
            let partial = 0;
            for (let j = start; j < Math.min(start + 4, end); j++) {
              indices.set(a.id, j);
              partial = round(partial + expr(e.body));
            }
            acc = round(acc + partial);
          }
        } else
          loops(e.axes, 0, () => {
            const lane = expr(e.body);
            acc = round(e.fn === 'max' ? Math.max(acc, lane) : acc + lane);
          });
        return acc;
      }
    }
  }
  for (const s of f.defs) {
    const shape = s.dims.map(d => value(d, shapes));
    if (!shape.every(n => Number.isSafeInteger(n) && n >= 0)) fail(s.at, 'invalid extent');
    const data = new A(product(shape));
    let offset = 0;
    loops(s.axes, 0, () => {
      data[offset++] = expr(s.rhs);
    });
    tensors.set(s.name, { shape, data });
  }
  return tensors.get(f.ret)!;
}
