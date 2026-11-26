import { shapeAnchors } from './check.js';
import { evalAffine } from './model.js';
import type { Affine, Axis, Expr, Loc, Param, TensorFn } from './model.js';

export type Precision = 'f32' | 'f64';
export interface Tensor {
  shape: number[];
  data: Float32Array | Float64Array;
}
export type Inputs = Record<string, Tensor>;
export interface Budget {
  steps: number;
  elements: number;
}
export class EvaluationDomainError extends Error {
  constructor(at: Loc, message: string) {
    super(`${at.line}:${at.col}: ${message}`);
  }
}

function length(shape: readonly number[], at: Loc, limit: number): number {
  if (shape.some(n => !Number.isSafeInteger(n) || n < 0))
    throw new EvaluationDomainError(at, 'invalid tensor extent');
  const count = shape.includes(0) ? 0 : shape.reduce((a, b) => a * b, 1);
  if (!Number.isSafeInteger(count) || count > limit)
    throw new EvaluationDomainError(at, 'tensor element limit exceeded');
  return count;
}

export function dimensions(dims: readonly Affine[], values: ReadonlyMap<string, number>, at: Loc): number[] {
  return dims.map(d => evalAffine(d, values, at));
}

export function tensorSize(shape: number[], at: Loc, limit: number): number {
  return length(shape, at, limit);
}

function bind(fn: TensorFn, inputs: Inputs, limit: number): Map<string, number> {
  if (Object.keys(inputs).length !== fn.params.length)
    throw new EvaluationDomainError(fn.at, 'wrong input names');
  for (const p of fn.params) {
    if (!Object.hasOwn(inputs, p.name)) throw new EvaluationDomainError(p.at, `missing input '${p.name}'`);
    const { shape, data } = inputs[p.name];
    if (!Array.isArray(shape) || shape.length !== p.shape.length)
      throw new EvaluationDomainError(p.at, `wrong input rank for '${p.name}'`);
    const n = length(shape, p.at, limit);
    if (!(data instanceof Float32Array || data instanceof Float64Array) || data.length !== n)
      throw new EvaluationDomainError(p.at, `wrong input buffer for '${p.name}'`);
    for (const v of data)
      if (!Number.isFinite(v)) throw new EvaluationDomainError(p.at, 'inputs must be finite');
  }
  const values = new Map<string, number>();
  for (const [name, { param, axis }] of shapeAnchors(fn)) {
    const d = param.shape[axis];
    const n = (inputs[param.name].shape[axis] - d.c) / d.terms[0][1];
    if (!Number.isSafeInteger(n) || n < 0)
      throw new EvaluationDomainError(param.at, `invalid binding for '${name}'`);
    values.set(name, n);
  }
  for (const p of fn.params) {
    if (dimensions(p.shape, values, p.at).some((n, i) => n !== inputs[p.name].shape[i]))
      throw new EvaluationDomainError(p.at, `inconsistent input shape for '${p.name}'`);
  }
  return values;
}

export function evaluate(fn: TensorFn, inputs: Inputs, precision: Precision, budget?: Budget): Tensor {
  let steps = budget?.steps ?? Infinity;
  const tick = (at: Loc) => {
    if (--steps < 0) throw new EvaluationDomainError(at, 'evaluation step limit exceeded');
  };
  const limit = budget?.elements ?? Number.MAX_SAFE_INTEGER;
  const shapes = bind(fn, inputs, limit);
  const round = precision === 'f32' ? Math.fround : (value: number) => value;
  const Buffer = precision === 'f32' ? Float32Array : Float64Array;
  const indices = new Map<string, number>();
  const tensors = new Map<string, Tensor>();
  const addInput = (p: Param) => {
    const t = inputs[p.name];
    // Materialize in the selected arithmetic even when the function directly returns an input.
    tensors.set(p.id, { shape: [...t.shape], data: Buffer.from(t.data) });
  };
  for (const p of fn.params) addInput(p);

  const axisExtent = (a: Axis): number => {
    const n = evalAffine(a.extent, shapes, a.at);
    if (n < 0) throw new EvaluationDomainError(a.at, 'negative reduction extent');
    return n;
  };
  const loop = (axes: readonly Axis[], extents: readonly number[], visit: () => void) => {
    if (extents.includes(0)) return;
    const nest = (depth: number) => {
      if (depth === axes.length) {
        visit();
        return;
      }
      const a = axes[depth];
      for (let i = 0; i < extents[depth]; i++) {
        tick(a.at);
        indices.set(a.id, i);
        nest(depth + 1);
      }
      indices.delete(a.id);
    };
    nest(0);
  };
  const scalar = (e: Expr): number => {
    tick(e.at);
    switch (e.op) {
      case 'literal':
        return round(Number(e.text));
      case 'shape':
        return round(shapes.get(e.name)!);
      case 'load': {
        const t = tensors.get(e.tensor)!;
        let offset = 0;
        for (let i = 0; i < e.subs.length; i++)
          offset = offset * t.shape[i] + evalAffine(e.subs[i], indices, e.at);
        return t.data[offset];
      }
      case 'neg':
        return round(-scalar(e.arg));
      case '+':
        return round(scalar(e.left) + scalar(e.right));
      case '-':
        return round(scalar(e.left) - scalar(e.right));
      case '*':
        return round(scalar(e.left) * scalar(e.right));
      case '/':
        return round(scalar(e.left) / scalar(e.right));
      case 'call': {
        const a = scalar(e.args[0]);
        return round(e.fn === 'max' || e.fn === 'min' ? Math[e.fn](a, scalar(e.args[1])) : Math[e.fn](a));
      }
      case 'sum':
      case 'max': {
        let acc = e.op === 'sum' ? 0 : -Infinity;
        loop(e.axes, e.axes.map(axisExtent), () => {
          const v = scalar(e.body);
          acc = round(e.op === 'sum' ? acc + v : Math.max(acc, v));
        });
        return acc;
      }
      case 'blockedSum': {
        let acc = 0;
        const n = axisExtent(e.axis);
        for (let start = 0; start < n; ) {
          tick(e.at);
          const end = start + Math.min(e.blockSize, n - start);
          let partial = 0;
          for (let i = start; i < end; i++) {
            tick(e.axis.at);
            indices.set(e.axis.id, i);
            partial = round(partial + scalar(e.body));
          }
          acc = round(acc + partial);
          start = end;
        }
        indices.delete(e.axis.id);
        return acc;
      }
    }
  };
  for (const s of fn.statements) {
    const shape = dimensions(s.shape, shapes, s.at);
    const data = new Buffer(length(shape, s.at, limit));
    const words = precision === 'f32' ? new Uint32Array(data.buffer) : undefined;
    let offset = 0;
    loop(s.axes, shape, () => {
      const value = scalar(s.expr);
      if (words && Number.isNaN(value)) words[offset] = 0x7fc00000;
      else data[offset] = value;
      offset++;
    });
    tensors.set(s.id, { shape, data });
  }
  return tensors.get(fn.result)!;
}
