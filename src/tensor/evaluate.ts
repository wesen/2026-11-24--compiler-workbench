import { evalAff, plain } from './affine.js';
import { Index } from './ir.js';
export type Precision = 'f32' | 'f64';
export interface Tensor {
  shape: number[];
  data: Float32Array | Float64Array;
}
export type Inputs = Record<string, Tensor>;
export const size = (shape: number[]) => shape.reduce((n, k) => n * k, 1);
const ops: Record<string, (...xs: number[]) => number> = {
  neg: x => -x,
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  exp: Math.exp,
  log: Math.log,
  sqrt: Math.sqrt,
  tanh: Math.tanh,
  max: Math.max,
  min: Math.min,
};

/** A structural upper bound: one visit per expression and per loop iteration (including partial index tuples).
 * The last clipped block can be shorter. No step count depends on floating-point data. */
export function workBound(ix: Index, fn: string, env: Map<string, number>) {
  function loop(id: string, body: number) {
    return ix.kids(id, 'axis').reduceRight((cost, axis) => {
      let n = evalAff(ix.extent(axis), env);
      const a = ix.a(axis);
      if (a.mode === 'starts') n = Math.ceil(n / Number(a.width));
      if (a.mode === 'inner') n = Math.min(n, Number(ix.a(ix.one(axis, 'block')).width));
      return n === 0 ? 0 : n * (1 + cost);
    }, body);
  }
  function expr(id: string): number {
    return (
      1 +
      loop(
        id,
        ix.kids(id, 'arg').reduce((n, x) => n + expr(x), 0),
      )
    );
  }
  return ix.kids(fn, 'stmt').reduce((n, id) => n + loop(id, expr(ix.one(id, 'arg'))), 0);
}
export function evaluate(
  ix: Index,
  fn: string,
  inputs: Inputs,
  precision: Precision,
  checkBudget = false,
): Tensor {
  if (ix.n(fn)?.kind !== 'fn') throw Error(`unknown function ${fn}`);
  const params = ix.kids(fn, 'param'),
    shapes = new Map<string, number>(),
    indices = new Map<string, number>(),
    tensors = new Map<string, Tensor>();
  const Buffer = precision === 'f32' ? Float32Array : Float64Array,
    round = precision === 'f32' ? Math.fround : (x: number) => x;
  if (params.length !== Object.keys(inputs).length) throw Error('parameter count mismatch');
  for (const id of params) {
    const name = ix.name(id),
      x = Object.hasOwn(inputs, name) ? inputs[name] : undefined;
    if (
      !x ||
      x.shape.length !== ix.dims(id).length ||
      x.shape.some(k => !Number.isSafeInteger(k) || k < 0) ||
      size(x.shape) !== x.data.length
    )
      throw Error(`invalid input ${name}`);
    ix.dims(id).forEach((d, j) => {
      const symbol = plain(d);
      if (symbol) shapes.set(symbol, x.shape[j]);
    });
    if (!x.data.every(Number.isFinite)) throw Error('nonfinite input');
    tensors.set(id, { shape: [...x.shape], data: new Buffer(x.data) });
  }
  const shape = (id: string) => ix.dims(id).map(d => evalAff(d, shapes));
  for (const id of params)
    if (shape(id).some((n, j) => n !== tensors.get(id)!.shape[j])) throw Error('input shape mismatch');
  let remaining = checkBudget ? workBound(ix, fn, shapes) : Infinity;
  const step = () => {
    if (--remaining < 0) throw Error('work bound exceeded');
  };
  function loops(owner: string, body: () => void) {
    const axes = ix.kids(owner, 'axis').map(id => {
      const a = ix.a(id),
        block = ix.kids(id, 'block')[0];
      return {
        id,
        mode: a.mode,
        extent: evalAff(ix.extent(id), shapes),
        block,
        width: Number(block ? ix.a(block).width : (a.width ?? 1)),
      };
    });
    function iter(j: number) {
      if (j === axes.length) {
        body();
        return;
      }
      const a = axes[j],
        start = a.block ? indices.get(a.block)! : 0,
        end = a.block ? Math.min(start + a.width, a.extent) : a.extent;
      for (let k = start; k < end; k += a.mode === 'starts' ? a.width : 1) {
        step();
        indices.set(a.id, k);
        iter(j + 1);
      }
    }
    return () => iter(0);
  }
  function scalar(id: string): () => number {
    const op = ix.n(id).kind.slice(5),
      args = ix.kids(id, 'arg').map(scalar);
    let calc: () => number;
    if (op === 'load') {
      const t = tensors.get(ix.one(id, 'reads'))!,
        forms = ix.indices(id);
      calc = () => t.data[forms.reduce((n, a, j) => n * t.shape[j] + evalAff(a, indices), 0)];
    } else if (op === 'shape' || op === 'literal') {
      const n = round(op === 'shape' ? shapes.get(ix.name(id))! : Number(ix.a(id).text));
      calc = () => n;
    } else if (op.startsWith('reduce.')) {
      const sum = op === 'reduce.sum';
      let acc: number;
      const run = loops(id, () => {
        const v = args[0]();
        acc = round(sum ? acc + v : Math.max(acc, v));
      });
      calc = () => {
        acc = sum ? 0 : -Infinity;
        run();
        return acc;
      };
    } else {
      const f = ops[op];
      calc = args.length === 1 ? () => round(f(args[0]())) : () => round(f(args[0](), args[1]()));
    }
    return () => {
      step();
      return calc();
    };
  }
  for (const id of ix.kids(fn, 'stmt')) {
    const dims = shape(id);
    if (dims.some(n => n < 0)) throw Error('negative tensor extent');
    const data = new Buffer(size(dims)),
      value = scalar(ix.one(id, 'arg'));
    let offset = 0;
    loops(id, () => {
      data[offset++] = value();
    })();
    tensors.set(id, { shape: dims, data });
  }
  return tensors.get(ix.one(fn, 'returns'))!;
}
