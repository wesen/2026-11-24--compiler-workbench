import { evalAff, fail, plain, width, type Binder, type Expr, type Fn } from './model.js';
export type Precision = 'f32' | 'f64';
export interface Tensor {
  shape: number[];
  data: Float32Array | Float64Array;
}
export type Inputs = Record<string, Tensor>;
export const size = (shape: number[]) => shape.reduce((a, b) => a * b, 1);
const operations: Record<string, (a: number, b: number) => number> = {
  neg: a => -a,
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  exp: Math.exp,
  log: Math.log,
  sqrt: Math.sqrt,
  tanh: Math.tanh,
  min: Math.min,
  max: Math.max,
};
export function evaluate(f: Fn, inputs: Inputs, precision: Precision): Tensor {
  const round = precision === 'f32' ? Math.fround : (x: number) => x,
    ArrayType = precision === 'f32' ? Float32Array : Float64Array;
  const shapes = new Map<string, number>(),
    indices = new Map<string, number>(),
    values = new Map<string, Tensor>();
  for (const p of f.params) {
    const t = Object.hasOwn(inputs, p.name) ? inputs[p.name] : undefined;
    if (!t || t.shape.length !== p.shape.length || t.data.length !== size(t.shape))
      fail(p.at, 'input shape mismatch');
    p.shape.forEach((a, i) => {
      const k = plain(a);
      if (k) shapes.set(k, t!.shape[i]);
    });
  }
  for (const p of f.params) {
    const t = inputs[p.name];
    if (!p.shape.every((a, i) => evalAff(a, shapes) === t.shape[i])) fail(p.at, 'input shape mismatch');
    values.set(p.id, { shape: t.shape.slice(), data: new ArrayType(t.data) });
  }
  function loops(axes: Binder[], body: () => void, level = 0) {
    if (level === axes.length) {
      body();
      return;
    }
    const b = axes[level];
    let n = evalAff(b.dim, shapes);
    if (b.loop?.kind === 'blocks') n = Math[b.loop.round](n / width);
    if (b.loop?.kind === 'lanes') n = Math.min(width, n - width * indices.get(b.loop.block)!);
    for (let i = 0; i < n; i++) {
      indices.set(b.id, i);
      loops(axes, body, level + 1);
    }
  }
  function scalar(e: Expr): number {
    switch (e.tag) {
      case 'literal':
        return round(Number(e.text));
      case 'shape':
        return round(shapes.get(e.name)!);
      case 'load': {
        const t = values.get(e.def)!;
        let offset = 0;
        for (let j = 0; j < t.shape.length; j++) {
          const i = evalAff(e.subs[j], indices);
          if (i < 0 || i >= t.shape[j]) fail(e.at, 'index out of range');
          offset = offset * t.shape[j] + i;
        }
        return t.data[offset];
      }
      case 'op': {
        const a = scalar(e.args[0]);
        return round(operations[e.op](a, e.args.length === 2 ? scalar(e.args[1]) : 0));
      }
      case 'reduce': {
        let acc = e.op === 'sum' ? 0 : -Infinity;
        loops(e.axes, () => {
          const x = scalar(e.body);
          acc = round(e.op === 'sum' ? acc + x : Math.max(acc, x));
        });
        return acc;
      }
    }
  }
  for (const s of f.stmts) {
    const shape = s.shape.map(a => evalAff(a, shapes)),
      data = new ArrayType(size(shape));
    let i = 0;
    loops(s.axes, () => {
      data[i++] = scalar(s.body);
    });
    values.set(s.id, { shape, data });
  }
  return values.get(f.result)!;
}
