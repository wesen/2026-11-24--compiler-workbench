import { valueOf } from './affine.js';
import { shapeNames } from './check.js';
import { children, errorAt, type Axis, type Expr, type Shape, type TensorFn } from './model.js';

export interface Tensor {
  shape: number[];
  data: Float32Array | Float64Array;
}
export type Inputs = Record<string, Tensor>;
export type Precision = 'f32' | 'f64';
type Binding = ReadonlyMap<string, number>;
export interface EvalLimits {
  readonly cells: number;
  readonly work: number;
}
export class EvaluationLimit extends Error {}
export class InvalidExtent extends Error {}

export function cellCount(shape: readonly number[]): number {
  if (shape.includes(0)) return 0;
  return shape.reduce((a, b) => a * b, 1);
}

const extentOK = (n: number) => Number.isSafeInteger(n) && n >= 0;
const atShape = (a: import('./affine.js').Affine, env: Binding): number => {
  const n = valueOf(a, name => env.get(name)!);
  if (!extentOK(n)) throw new InvalidExtent(`invalid concrete extent ${n}`);
  return n;
};
export const concreteShape = (shape: Shape, env: Binding): number[] => shape.map(a => atShape(a, env));

function bindInputs(fn: TensorFn, inputs: Inputs): Binding {
  const env = new Map<string, number>();
  if (Object.keys(inputs).length !== fn.params.length) errorAt(fn.at, 'expected exactly the named inputs');
  for (const p of fn.params) {
    const input = Object.hasOwn(inputs, p.name) ? inputs[p.name] : undefined;
    if (
      !input ||
      !Array.isArray(input.shape) ||
      input.shape.length !== p.shape.length ||
      !input.shape.every(extentOK) ||
      !(input.data instanceof Float32Array || input.data instanceof Float64Array) ||
      cellCount(input.shape) !== input.data.length ||
      !input.data.every(Number.isFinite)
    ) {
      errorAt(p.at, `invalid row-major input '${p.name}'`);
    }
    p.shape.forEach((axis, i) => {
      if (axis.terms.length !== 1) return;
      const [name, coeff] = axis.terms[0];
      const delta = BigInt(input.shape[i]) - BigInt(axis.constant),
        scale = BigInt(coeff);
      const n = Number(delta / scale);
      if (delta % scale !== 0n || !extentOK(n) || (env.has(name) && env.get(name) !== n))
        errorAt(p.at, `inconsistent extent for shape name '${name}'`);
      env.set(name, n);
    });
  }
  for (const p of fn.params)
    if (concreteShape(p.shape, env).some((d, i) => d !== inputs[p.name].shape[i]))
      errorAt(p.at, `input '${p.name}' does not match its shape`);
  return env;
}

function checkCells(shape: readonly number[], limit = Infinity): number {
  const cells = cellCount(shape);
  if (cells > limit) throw new EvaluationLimit('tensor cell limit exceeded');
  if (!Number.isSafeInteger(cells)) throw new InvalidExtent('unrepresentable tensor size');
  return cells;
}

/** Sample admission for the source artifact. Uses the same visit accounting as the interpreter. */
export function admits(fn: TensorFn, env: Binding, limits: EvalLimits): boolean {
  try {
    for (const p of fn.params) checkCells(concreteShape(p.shape, env), limits.cells);
    let work = 0;
    function nest(dims: readonly number[], body: () => number, i = 0): number {
      if (i === dims.length) return body();
      return dims[i] === 0 ? 0 : dims[i] * (1 + nest(dims, body, i + 1));
    }
    function cost(e: Expr): number {
      if (e.tag === 'fold') {
        return (
          1 +
          nest(
            e.axes.map(a => atShape(a.extent, env)),
            () => cost(e.body),
          )
        );
      }
      return 1 + children(e).reduce((n, child) => n + cost(child), 0);
    }
    for (const stmt of fn.statements) {
      const dims = concreteShape(stmt.shape, env);
      if (checkCells(dims, limits.cells)) work += nest(dims, () => cost(stmt.expr));
      if (work > limits.work) return false;
    }
    return true;
  } catch (e) {
    if (e instanceof InvalidExtent || e instanceof EvaluationLimit) return false;
    throw e;
  }
}

export function evaluate(fn: TensorFn, inputs: Inputs, precision: Precision, limits?: EvalLimits): Tensor {
  const env = bindInputs(fn, inputs);
  const tensors = new Map(fn.params.map(p => [p.name, inputs[p.name]]));
  const round = precision === 'f32' ? Math.fround : (x: number) => x;
  const ArrayType = precision === 'f32' ? Float32Array : Float64Array;
  const indices = new Map<string, number>();
  const extents = new Map<Axis, number>();
  const sizes = fn.statements.map(stmt => concreteShape(stmt.shape, env));
  let remaining = limits?.work ?? Infinity;
  const tick = () => {
    if (--remaining < 0) throw new EvaluationLimit('evaluation work limit exceeded');
  };
  const sizeOf = (axis: Axis) => {
    let size = extents.get(axis);
    if (size === undefined) {
      size = atShape(axis.extent, env);
      extents.set(axis, size);
    }
    return size;
  };
  function iterate(axes: readonly Axis[], body: () => void, depth = 0): void {
    if (depth === axes.length) {
      body();
      return;
    }
    const axis = axes[depth],
      range = axis.range,
      extent = sizeOf(axis);
    let start = 0,
      end = extent;
    if (range.kind === 'blocks') end = Math.ceil(extent / range.size);
    if (range.kind === 'within') {
      start = range.size * indices.get(range.block)!;
      end = start + Math.min(extent - start, range.size);
    }
    for (let i = start; i < end; i++) {
      tick();
      indices.set(axis.id, i);
      iterate(axes, body, depth + 1);
    }
  }
  function scalar(e: Expr): number {
    tick();
    switch (e.tag) {
      case 'literal':
        return round(Number(e.text));
      case 'shape':
        return round(env.get(e.text)!);
      case 'load': {
        const t = tensors.get(e.load.tensor)!;
        let offset = 0;
        for (let k = 0; k < t.shape.length; k++)
          offset = offset * t.shape[k] + valueOf(e.load.subscripts[k], name => indices.get(name)!);
        return round(t.data[offset]);
      }
      case 'neg':
        return round(-scalar(e.body));
      case 'binary': {
        const a = scalar(e.left),
          b = scalar(e.right);
        switch (e.op) {
          case '+':
            return round(a + b);
          case '-':
            return round(a - b);
          case '*':
            return round(a * b);
          case '/':
            return round(a / b);
        }
      }
      case 'call': {
        const x = scalar(e.args[0]);
        return round(e.op === 'min' || e.op === 'max' ? Math[e.op](x, scalar(e.args[1])) : Math[e.op](x));
      }
      case 'fold': {
        let acc = e.op === 'sum' ? 0 : -Infinity;
        iterate(e.axes, () => {
          const x = scalar(e.body);
          acc = round(e.op === 'sum' ? acc + x : Math.max(acc, x));
        });
        return acc;
      }
    }
  }
  for (const p of fn.params) checkCells(inputs[p.name].shape, limits?.cells);
  fn.statements.forEach((stmt, i) => {
    const shape = sizes[i];
    const data = new ArrayType(checkCells(shape, limits?.cells));
    let pos = 0;
    if (data.length)
      iterate(stmt.axes, () => {
        data[pos++] = scalar(stmt.expr);
      });
    tensors.set(stmt.name, { shape, data });
  });
  const returned = tensors.get(fn.return)!;
  const data = new ArrayType(returned.data);
  if (data instanceof Float32Array) {
    const bits = new Uint32Array(data.buffer);
    for (let i = 0; i < data.length; i++) if (Number.isNaN(data[i])) bits[i] = 0x7fc00000;
  }
  return { shape: [...returned.shape], data };
}
