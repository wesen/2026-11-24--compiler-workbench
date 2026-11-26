import { singleName, valueOf, type Expr, type Range, type TensorFn } from './model.js';
export type Precision = 'f32' | 'f64';
export interface Tensor {
  shape: number[];
  data: Float32Array | Float64Array;
}
export type Inputs = Record<string, Tensor>;
export const sizeOf = (shape: number[]) => shape.reduce((n, d) => n * d, 1);

export function evaluate(fn: TensorFn, inputs: Inputs, precision: Precision): Tensor {
  const BufferType = precision === 'f32' ? Float32Array : Float64Array;
  const round = precision === 'f32' ? Math.fround : (x: number) => x;
  const shapes = new Map<string, number>(),
    indices = new Map<string, number>(),
    tensors = new Map<string, Tensor>();
  for (const p of fn.params) {
    const input = inputs[p.name];
    p.shape.forEach((d, i) => {
      const symbol = singleName(d);
      if (symbol !== undefined) shapes.set(symbol, input.shape[i]);
    });
    tensors.set(p.name, { shape: [...input.shape], data: new BufferType(input.data) });
  }
  const extent = (r: Range) => valueOf(r.extent, shapes);
  // Bind invariant strides and extents once per expression, before entering its loops.
  function scalar(e: Expr): () => number {
    switch (e.kind) {
      case 'literal': {
        const n = round(Number(e.text));
        return () => n;
      }
      case 'shape': {
        const n = round(shapes.get(e.name)!);
        return () => n;
      }
      case 'read': {
        const t = tensors.get(e.tensor)!;
        return () => {
          let pos = 0;
          for (let i = 0; i < e.indices.length; i++) {
            const index = valueOf(e.indices[i], indices);
            if (index < 0 || index >= t.shape[i]) throw new RangeError(`out-of-bounds read from ${e.tensor}`);
            pos = pos * t.shape[i] + index;
          }
          return t.data[pos];
        };
      }
      case 'fold': {
        const body = scalar(e.body),
          ranges = e.axes.map(r => ({ r, n: extent(r) }));
        const initial = e.op === 'sum' ? 0 : -Infinity;
        const step =
          e.op === 'sum'
            ? (a: number, b: number) => round(a + b)
            : (a: number, b: number) => round(Math.max(a, b));
        return () => {
          let acc = initial;
          function loop(axis: number): void {
            if (axis === ranges.length) {
              acc = step(acc, body());
              return;
            }
            const { r, n } = ranges[axis];
            const lo = r.kind === 'within' ? indices.get(r.outer)! * r.size : 0;
            const hi =
              r.kind === 'within'
                ? Math.min(n, lo + r.size)
                : r.kind === 'blocks'
                  ? Math.ceil(n / r.size)
                  : n;
            for (let i = lo; i < hi; i++) {
              indices.set(r.id, i);
              loop(axis + 1);
            }
          }
          loop(0);
          return acc;
        };
      }
      case 'binary': {
        const l = scalar(e.left),
          r = scalar(e.right);
        switch (e.op) {
          case '+':
            return () => round(l() + r());
          case '-':
            return () => round(l() - r());
          case '*':
            return () => round(l() * r());
          case '/':
            return () => round(l() / r());
          case 'min':
            return () => round(Math.min(l(), r()));
          case 'max':
            return () => round(Math.max(l(), r()));
        }
        break;
      }
      default: {
        const x = scalar(e.arg);
        if (e.kind === 'neg') return () => round(-x());
        const op = Math[e.kind];
        return () => round(op(x()));
      }
    }
    throw new Error('unknown scalar expression');
  }
  for (const d of fn.definitions) {
    const shape = d.shape.map(a => valueOf(a, shapes)),
      data = new BufferType(sizeOf(shape)),
      body = scalar(d.body);
    let offset = 0;
    function loop(axis: number): void {
      if (axis === shape.length) {
        data[offset++] = body();
        return;
      }
      for (let i = 0; i < shape[axis]; i++) {
        indices.set(d.axes[axis].id, i);
        loop(axis + 1);
      }
    }
    loop(0);
    tensors.set(d.name, { shape, data });
  }
  return tensors.get(fn.result)!;
}
