import { solve, value } from './affine.js';
import {
  bounds,
  errorAt,
  shapeOf,
  type Binder,
  type Expr,
  type Location,
  type Operator,
  type TensorFunction,
} from './ir.js';

export type Precision = 'f32' | 'f64';
export interface Tensor {
  shape: number[];
  data: Float32Array | Float64Array;
}
interface Layout {
  shape: number[];
  size: number;
}
export type Layouts = ReadonlyMap<string, Layout>;

export function elementCount(shape: readonly number[]): bigint {
  return shape.reduce((n, d) => n * BigInt(d), 1n);
}
function extent(n: bigint, at: Location) {
  if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) throw errorAt(at, `invalid concrete extent ${n}`);
  return Number(n);
}
export function dimensions(fn: TensorFunction, names: ReadonlyMap<string, bigint>): number[][] {
  return fn.params.map(p => shapeOf(p.shape, names).map(n => extent(n, p.at)));
}

export function plan(
  fn: TensorFunction,
  shapes: readonly (readonly number[])[],
  maxElements = Number.MAX_SAFE_INTEGER,
) {
  if (shapes.length !== fn.params.length) throw errorAt(fn.at, 'incorrect input count');
  fn.params.forEach((p, i) => {
    const s = shapes[i];
    if (!Array.isArray(s) || s.length !== p.shape.length || !s.every(n => Number.isSafeInteger(n) && n >= 0))
      throw errorAt(p.at, `invalid input shape for ${p.name}`);
  });
  const names = solve(
    fn.shapeNames,
    fn.params.flatMap(p => p.shape),
    shapes.flat(),
  );
  if (!names) throw errorAt(fn.at, 'inconsistent input shapes');
  const lookup = (id: string) => names.get(id)!;
  const layouts = new Map<string, Layout>();
  const lengths = new Map<string, number>();
  let steps = 0n;
  function record(id: string, shape: number[], at: Location) {
    const size = elementCount(shape);
    if (size > BigInt(maxElements)) throw errorAt(at, `tensor exceeds ${maxElements} elements`);
    layouts.set(id, { shape, size: Number(size) });
    return size;
  }
  function cost(e: Expr, scope: Map<string, Binder>, active: boolean): bigint {
    switch (e.kind) {
      case 'load': {
        if (active) {
          const shape = layouts.get(e.tensor)!.shape;
          e.access.forEach((a, i) => {
            const { lo, hi } = bounds(a, scope);
            if (value(lo, lookup) < 0n || value(hi, lookup) >= BigInt(shape[i]))
              throw errorAt(e.at, `out-of-bounds access on axis ${i + 1}`);
          });
        }
        return 1n;
      }
      case 'op':
        return e.args.reduce((n, a) => n + cost(a, scope, active), 1n);
      case 'reduce':
      case 'blockedSum': {
        const inner = new Map(scope);
        const count = e.binders.reduce((n, b) => {
          const len = extent(value(b.extent, lookup), b.at);
          lengths.set(b.id, len);
          inner.set(b.id, b);
          return n * BigInt(len);
        }, 1n);
        const body = cost(e.body, inner, active && count !== 0n);
        const block = BigInt(e.kind === 'blockedSum' ? e.blockSize : 1);
        const extra = e.kind === 'blockedSum' ? 2n * ((count + block - 1n) / block) : 0n;
        return 1n + count * (2n + body) + extra;
      }
      default:
        return 1n;
    }
  }
  fn.params.forEach((p, i) => record(p.id, [...shapes[i]], p.at));
  for (const d of fn.definitions) {
    const shape = shapeOf(d.shape, names).map(n => extent(n, d.at));
    const size = record(d.id, shape, d.at);
    const scope = new Map(
      d.binders.map((b, i) => {
        lengths.set(b.id, shape[i]);
        return [b.id, b];
      }),
    );
    steps += size * (1n + cost(d.expr, scope, size !== 0n));
  }
  return { names, layouts, lengths, steps };
}
export type Plan = ReturnType<typeof plan>;

const ops: Record<Operator, (a: number, b: number) => number> = {
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

/** Enumerate complete tuples in row-major order, without touching empty Cartesian products. */
function eachIndex(shape: readonly number[], fn: (coords: readonly number[], offset: number) => void) {
  if (shape.includes(0)) return;
  const coords = shape.map(() => 0);
  for (let offset = 0; ; offset++) {
    fn(coords, offset);
    let axis = shape.length - 1;
    for (; axis >= 0; axis--) {
      if (++coords[axis] < shape[axis]) break;
      coords[axis] = 0;
    }
    if (axis < 0) return;
  }
}

export function evaluate(
  fn: TensorFunction,
  p: Plan,
  inputs: readonly Tensor['data'][],
  precision: Precision,
): Tensor {
  const round = precision === 'f32' ? Math.fround : (n: number) => n;
  const Buffer = precision === 'f32' ? Float32Array : Float64Array;
  const tensors = new Map<string, Tensor['data']>();
  const coords = new Map<string, bigint>();
  fn.params.forEach((param, i) => {
    const input = inputs[i];
    if (
      !(input instanceof Float32Array || input instanceof Float64Array) ||
      input.length !== p.layouts.get(param.id)!.size
    )
      throw errorAt(param.at, `incorrect input buffer for ${param.name}`);
    const data = Buffer.from(input);
    if (data.some(n => !Number.isFinite(n))) throw errorAt(param.at, `nonfinite input for ${param.name}`);
    tensors.set(param.id, data);
  });
  function bind(binders: readonly Binder[], index: readonly number[]) {
    binders.forEach((b, j) => coords.set(b.id, BigInt(index[j])));
  }
  function scalar(e: Expr): number {
    switch (e.kind) {
      case 'literal':
        return round(Number(e.text));
      case 'shape':
        return round(Number(p.names.get(e.name)!));
      case 'op':
        return round(ops[e.op](scalar(e.args[0]), e.args.length === 2 ? scalar(e.args[1]) : 0));
      case 'load': {
        const shape = p.layouts.get(e.tensor)!.shape;
        const offset = e.access.reduce(
          (n, a, i) => n * shape[i] + Number(value(a, id => coords.get(id)!)),
          0,
        );
        return tensors.get(e.tensor)![offset];
      }
      case 'reduce': {
        let acc = e.op === 'sum' ? 0 : -Infinity;
        eachIndex(
          e.binders.map(b => p.lengths.get(b.id)!),
          index => {
            bind(e.binders, index);
            const term = scalar(e.body);
            acc = round(e.op === 'sum' ? acc + term : Math.max(acc, term));
          },
        );
        return acc;
      }
      case 'blockedSum': {
        const id = e.binders[0].id,
          size = p.lengths.get(id)!;
        let acc = 0;
        for (let block = 0; block < size; ) {
          let part = 0;
          const end = block + Math.min(size - block, e.blockSize);
          for (; block < end; block++) {
            coords.set(id, BigInt(block));
            part = round(part + scalar(e.body));
          }
          acc = round(acc + part);
        }
        return acc;
      }
    }
  }
  for (const d of fn.definitions) {
    const { size, shape } = p.layouts.get(d.id)!;
    const data = new Buffer(size);
    const bits = precision === 'f32' ? new Uint32Array(data.buffer) : undefined;
    eachIndex(shape, (idx, offset) => {
      bind(d.binders, idx);
      const n = scalar(d.expr);
      if (bits && Number.isNaN(n)) bits[offset] = 0x7fc00000;
      else data[offset] = n;
    });
    tensors.set(d.id, data);
  }
  return { shape: [...p.layouts.get(fn.result)!.shape], data: tensors.get(fn.result)! };
}
