/**
 * The Tix evaluator (IRWB-020): one walk of the IR, run in an arithmetic.
 *
 * The order of evaluation is the meaning: statements in order, each tensor in row-major order, a reduction from its
 * initial value in increasing lexicographic order of its indices (the first outermost), one accumulation per step.
 * That order is written once, here. The three arithmetics differ only in what a value is and how one operation is
 * computed: `f32` rounds every result with `Math.fround` (the program's meaning), `f64` does not (the reference),
 * and `bound` carries, next to the f64 value, a first-order bound on the error of the f32 evaluation.
 */
import { affEval, extEval, extNames, type Aff, type Expr, type Extent, type Fn, type TixIR } from './ir.js';

/** A run that left the function's domain: a subscript outside its dim, or an extent below 1. */
export class TixTrap extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TixTrap';
  }
}

export interface Arithmetic<V> {
  readonly name: string;
  lit(x: number): V;
  shape(n: number): V;
  input(x: number): V;
  readonly zero: V;
  readonly negInf: V;
  neg(a: V): V;
  add(a: V, b: V): V;
  sub(a: V, b: V): V;
  mul(a: V, b: V): V;
  div(a: V, b: V): V;
  exp(a: V): V;
  log(a: V): V;
  sqrt(a: V): V;
  tanh(a: V): V;
  max(a: V, b: V): V;
  min(a: V, b: V): V;
}

const plain = (name: string, r: (x: number) => number): Arithmetic<number> => ({
  name,
  lit: r,
  shape: r,
  input: r,
  zero: 0,
  negInf: -Infinity,
  neg: a => -a,
  add: (a, b) => r(a + b),
  sub: (a, b) => r(a - b),
  mul: (a, b) => r(a * b),
  div: (a, b) => r(a / b),
  exp: a => r(Math.exp(a)),
  log: a => r(Math.log(a)),
  sqrt: a => r(Math.sqrt(a)),
  tanh: a => r(Math.tanh(a)),
  max: (a, b) => Math.max(a, b),
  min: (a, b) => Math.min(a, b),
});
export const F32: Arithmetic<number> = plain('f32', Math.fround);
export const F64: Arithmetic<number> = plain('f64', x => x);

/** An f64 value and a bound on |f32-evaluated value - exact value|. */
export interface Bounded {
  readonly v: number;
  readonly e: number;
}
/** The unit roundoff of f32. */
export const U32 = 2 ** -24;
/** A rounded operation with f64 result `v` whose operands' errors propagate to at most `p`. */
const rounded = (v: number, p: number): Bounded => ({ v, e: p + U32 * (Math.abs(v) + p) });
const unbounded = (v: number): Bounded => ({ v, e: Infinity });
export const BOUND: Arithmetic<Bounded> = {
  name: 'bound',
  lit: x => ({ v: x, e: U32 * Math.abs(x) }),
  shape: n => ({ v: n, e: 0 }),
  input: x => ({ v: x, e: 0 }),
  zero: { v: 0, e: 0 },
  negInf: { v: -Infinity, e: 0 },
  neg: a => ({ v: -a.v, e: a.e }),
  add: (a, b) => rounded(a.v + b.v, a.e + b.e),
  sub: (a, b) => rounded(a.v - b.v, a.e + b.e),
  mul: (a, b) => rounded(a.v * b.v, Math.abs(a.v) * b.e + Math.abs(b.v) * a.e + a.e * b.e),
  div: (a, b) => {
    const v = a.v / b.v,
      d = Math.abs(b.v) - b.e;
    return d > 0 ? rounded(v, (a.e + Math.abs(v) * b.e) / d) : unbounded(v);
  },
  exp: a => {
    const v = Math.exp(a.v);
    return rounded(v, a.e === 0 ? 0 : v * Math.expm1(a.e));
  },
  log: a => (a.v - a.e > 0 ? rounded(Math.log(a.v), -Math.log1p(-a.e / a.v)) : unbounded(Math.log(a.v))),
  sqrt: a => {
    const v = Math.sqrt(a.v);
    if (a.e === 0) return rounded(v, 0);
    return a.v - a.e >= 0 ? rounded(v, v - Math.sqrt(a.v - a.e)) : unbounded(v);
  },
  tanh: a => rounded(Math.tanh(a.v), a.e),
  max: (a, b) => ({ v: Math.max(a.v, b.v), e: Math.max(a.e, b.e) }),
  min: (a, b) => ({ v: Math.min(a.v, b.v), e: Math.max(a.e, b.e) }),
};

export interface TensorInput {
  readonly shape: readonly number[];
  readonly data: ArrayLike<number>;
}

/** The values of a function's shape names for these inputs; throws when the inputs do not fit the parameters. */
export function bindShapes(fn: Fn, inputs: Readonly<Record<string, TensorInput>>): Record<string, number> {
  const env: Record<string, number> = {};
  for (const p of fn.params) {
    const input = inputs[p.name];
    if (!input) throw new Error(`${fn.name}: no input for parameter '${p.name}'`);
    if (input.shape.length !== p.dims.length)
      throw new Error(
        `${fn.name}: '${p.name}' has rank ${p.dims.length}, the input has rank ${input.shape.length}`,
      );
    p.dims.forEach((d, k) => {
      const keys = Object.keys(d.terms);
      // a whole dim binds its shape name (the checker guarantees one exists for every name)
      if (d.c === 0 && keys.length === 1 && d.terms[keys[0]] === 1 && env[keys[0]] === undefined)
        env[keys[0]] = input.shape[k];
    });
  }
  for (const p of fn.params) {
    const input = inputs[p.name];
    let size = 1;
    p.dims.forEach((d, k) => {
      const want = affEval(d, env);
      if (want !== input.shape[k])
        throw new Error(`${fn.name}: dim ${k} of '${p.name}' is ${input.shape[k]}, expected ${want}`);
      size *= want;
    });
    if (input.data.length !== size)
      throw new Error(`${fn.name}: '${p.name}' needs ${size} elements, the input has ${input.data.length}`);
  }
  return env;
}

export interface Evaluated<V> {
  readonly shape: number[];
  readonly data: V[];
}

/** Run one function in an arithmetic. Inputs are row-major. */
export function evaluateFn<V>(
  fn: Fn,
  A: Arithmetic<V>,
  inputs: Readonly<Record<string, TensorInput>>,
): Evaluated<V> {
  const shapes = bindShapes(fn, inputs);
  const tensors = new Map<string, Evaluated<V>>();
  for (const p of fn.params) {
    const input = inputs[p.name];
    tensors.set(p.name, { shape: [...input.shape], data: Array.from(input.data, x => A.input(x)) });
  }

  for (const s of fn.stmts) {
    // index names of this statement get slots; a value is read from `idx` by closures built once per statement
    const slots = new Map<string, number>();
    const idx: number[] = [];
    const slotOf = (name: string) => {
      let k = slots.get(name);
      if (k === undefined) (slots.set(name, (k = idx.length)), idx.push(0));
      return k;
    };
    const affine = (a: Aff): (() => number) => {
      let c = a.c;
      const ks: number[] = [],
        ss: number[] = [];
      for (const [n, k] of Object.entries(a.terms)) {
        if (Object.hasOwn(shapes, n)) c += k * shapes[n];
        else (ks.push(k), ss.push(slotOf(n)));
      }
      if (ks.length === 0) return () => c;
      if (ks.length === 1) {
        const k0 = ks[0],
          s0 = ss[0];
        return () => c + k0 * idx[s0];
      }
      return () => {
        let v = c;
        for (let t = 0; t < ks.length; t++) v += ks[t] * idx[ss[t]];
        return v;
      };
    };
    const extent = (e: Extent): (() => number) => {
      if (e.k === 'aff') return affine(e.aff);
      // min and ceildiv extents are rare (blocked loops): evaluate them from the current index values
      const names = [...extNames(e)].filter(n => !Object.hasOwn(shapes, n)).map(n => [n, slotOf(n)] as const);
      return () => {
        const env: Record<string, number> = { ...shapes };
        for (const [n, k] of names) env[n] = idx[k];
        return extEval(e, env);
      };
    };
    const compile = (e: Expr): (() => V) => {
      switch (e.k) {
        case 'lit': {
          const v = A.lit(e.value);
          return () => v;
        }
        case 'shape': {
          const v = A.shape(shapes[e.name]);
          return () => v;
        }
        case 'ref': {
          const t = tensors.get(e.tensor);
          if (!t) throw new TixTrap(`${fn.name}/${s.name}: reads undefined tensor '${e.tensor}'`);
          const { shape, data } = t,
            subs = e.at.map(affine),
            rank = subs.length;
          if (rank !== shape.length) throw new TixTrap(`${fn.name}/${s.name}: rank of '${e.tensor}'`);
          return () => {
            let off = 0;
            for (let k = 0; k < rank; k++) {
              const i = subs[k]();
              if (i < 0 || i >= shape[k])
                throw new TixTrap(
                  `${fn.name}/${s.name}: subscript ${i} outside dim ${k} (${shape[k]}) of '${e.tensor}'`,
                );
              off = off * shape[k] + i;
            }
            return data[off];
          };
        }
        case 'neg': {
          const a = compile(e.a);
          return () => A.neg(a());
        }
        case 'bin': {
          const a = compile(e.a),
            b = compile(e.b);
          // the left operand is evaluated first
          if (e.op === '+') return () => A.add(a(), b());
          if (e.op === '-') return () => A.sub(a(), b());
          if (e.op === '*') return () => A.mul(a(), b());
          return () => A.div(a(), b());
        }
        case 'call': {
          const args = e.args.map(compile);
          const a = args[0],
            b = args[1];
          if (e.fn === 'max') return () => A.max(a(), b());
          if (e.fn === 'min') return () => A.min(a(), b());
          const f = A[e.fn];
          return () => f(a());
        }
        case 'reduce': {
          const n = e.indices.length,
            ss = e.indices.map(i => slotOf(i.name)),
            // an extent may mention an outer index of the same reduction, so it is read when its loop starts
            exts = e.indices.map(i => extent(i.extent)),
            body = compile(e.body),
            init = e.op === 'sum' ? A.zero : A.negInf,
            step = e.op === 'sum' ? A.add : A.max;
          if (n === 1) {
            const s0 = ss[0],
              e0 = exts[0];
            return () => {
              let acc = init;
              const count = e0();
              for (let i = 0; i < count; i++) {
                idx[s0] = i;
                acc = step(acc, body());
              }
              return acc;
            };
          }
          return () => {
            let acc = init;
            const loop = (k: number): void => {
              const count = exts[k](),
                sk = ss[k];
              for (let i = 0; i < count; i++) {
                idx[sk] = i;
                if (k === n - 1) acc = step(acc, body());
                else loop(k + 1);
              }
            };
            loop(0);
            return acc;
          };
        }
      }
    };

    const rank = s.indices.length,
      ss = s.indices.map(i => slotOf(i.name)),
      shape = s.indices.map(i => extent(i.extent)());
    let size = 1;
    for (const d of shape) {
      if (!(d >= 1)) throw new TixTrap(`${fn.name}/${s.name}: extent ${d} is below 1`);
      size *= d;
    }
    const body = compile(s.expr);
    const data: V[] = new Array(size);
    for (let k = 0; k < rank; k++) idx[ss[k]] = 0;
    for (let off = 0; off < size; off++) {
      data[off] = body();
      // advance the odometer, last index fastest (row-major)
      for (let k = rank - 1; k >= 0; k--) {
        if (++idx[ss[k]] < shape[k]) break;
        idx[ss[k]] = 0;
      }
    }
    tensors.set(s.name, { shape, data });
  }
  const out = tensors.get(fn.result);
  if (!out) throw new TixTrap(`${fn.name}: returns undefined tensor '${fn.result}'`);
  return out;
}

export function fnOf(ir: TixIR, name: string): Fn {
  const fn = Object.hasOwn(ir.fns, name) ? ir.fns[name] : undefined;
  if (!fn) throw new TixTrap(`no function '${name}'`);
  return fn;
}

export interface TensorResult<D> {
  shape: number[];
  data: D;
}
export function runF32(
  ir: TixIR,
  fn: string,
  inputs: Readonly<Record<string, TensorInput>>,
): TensorResult<Float32Array> {
  const r = evaluateFn(fnOf(ir, fn), F32, inputs);
  return { shape: r.shape, data: Float32Array.from(r.data) };
}
export function runF64(
  ir: TixIR,
  fn: string,
  inputs: Readonly<Record<string, TensorInput>>,
): TensorResult<Float64Array> {
  const r = evaluateFn(fnOf(ir, fn), F64, inputs);
  return { shape: r.shape, data: Float64Array.from(r.data) };
}
/** The f64 value of every element and the bound on the error of its f32 evaluation in this program's order. */
export function runBound(
  ir: TixIR,
  fn: string,
  inputs: Readonly<Record<string, TensorInput>>,
): { shape: number[]; value: Float64Array; bound: Float64Array } {
  const r = evaluateFn(fnOf(ir, fn), BOUND, inputs);
  return {
    shape: r.shape,
    value: Float64Array.from(r.data, x => x.v),
    bound: Float64Array.from(r.data, x => x.e),
  };
}
