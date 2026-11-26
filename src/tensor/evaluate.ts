/**
 * IRWB-020-N: the Tix evaluator. One interpreter, parameterised by rounding: `Math.fround` gives the f32 meaning
 * (every literal, shape value, operation and function result rounded), the identity gives the f64 reference.
 * `sum` starts at +0 and `max` at −∞; both walk their axes in lexicographic order, the first outermost, skip
 * iterations whose guard fails, and round after each step. Expressions are compiled once per statement into
 * closures over an integer index environment.
 */
import { A, extentValue, type Affine, type Expr, type TixModule } from './ir.js';

export interface TensorValue {
  readonly shape: number[];
  readonly data: Float32Array | Float64Array;
}
export type Round = (x: number) => number;
export const F32: Round = Math.fround;
export const F64: Round = x => x;

interface Buffer {
  readonly dims: readonly number[];
  readonly strides: readonly number[];
  readonly data: Float64Array;
}
const stridesOf = (dims: readonly number[]) => {
  const s = new Array<number>(dims.length);
  let k = 1;
  for (let d = dims.length - 1; d >= 0; d--) {
    s[d] = k;
    k *= dims[d];
  }
  return s;
};
const size = (dims: readonly number[]) => dims.reduce((a, b) => a * b, 1);

type Code = (env: Int32Array) => number;
type Lin = { readonly c: number; readonly slots: readonly number[]; readonly coefs: readonly number[] };
const linear = (a: Affine, slots: ReadonlyMap<string, number>): Lin => {
  const ks = Object.keys(a.t);
  return { c: a.c, slots: ks.map(k => slots.get(k)!), coefs: ks.map(k => a.t[k]) };
};
const at = (l: Lin, env: Int32Array) => {
  let v = l.c;
  for (let i = 0; i < l.slots.length; i++) v += l.coefs[i] * env[l.slots[i]];
  return v;
};

const UN: Record<string, (x: number) => number> = {
  neg: x => -x,
  exp: Math.exp,
  log: Math.log,
  sqrt: Math.sqrt,
  tanh: Math.tanh,
};
const BIN: Record<string, (x: number, y: number) => number> = {
  add: (x, y) => x + y,
  sub: (x, y) => x - y,
  mul: (x, y) => x * y,
  div: (x, y) => x / y,
  max: Math.max,
  min: Math.min,
};

/** Evaluate function `fn` of `m` on row-major inputs; the result data is a Float64Array of rounded values. */
export function evaluate(
  m: TixModule,
  fnName: string,
  inputs: Readonly<Record<string, { readonly shape: readonly number[]; readonly data: ArrayLike<number> }>>,
  round: Round,
): { shape: number[]; data: Float64Array } {
  const f = m.fns[fnName];
  if (!f) throw new Error(`no function ${fnName}`);
  const shapes: Record<string, number> = {};
  for (const p of f.params) {
    const v = inputs[p.name];
    if (!v) throw new Error(`${fnName}: missing input ${p.name}`);
    if (v.shape.length !== p.dims.length) throw new Error(`${fnName}: ${p.name} needs rank ${p.dims.length}`);
    p.dims.forEach((d, i) => {
      const n = A.plain(d);
      if (n === undefined) return;
      if (shapes[n] !== undefined && shapes[n] !== v.shape[i])
        throw new Error(`${fnName}: shape ${n} is ${shapes[n]} and ${v.shape[i]}`);
      shapes[n] = v.shape[i];
    });
  }
  for (const k of Object.keys(inputs))
    if (!f.params.some(p => p.name === k)) throw new Error(`${fnName}: unknown input ${k}`);
  const tensors = new Map<string, Buffer>();
  for (const p of f.params) {
    const v = inputs[p.name];
    const dims = p.dims.map(d => A.value(d, shapes));
    if (dims.some((d, i) => d !== v.shape[i] || !(d >= 1)))
      throw new Error(`${fnName}: ${p.name} has shape [${v.shape}], expected [${dims}]`);
    if (v.data.length !== size(dims))
      throw new Error(`${fnName}: ${p.name} has ${v.data.length} values, expected ${size(dims)}`);
    const data = new Float64Array(v.data.length);
    for (let i = 0; i < data.length; i++) data[i] = round(v.data[i]);
    tensors.set(`param:${p.name}`, { dims, strides: stridesOf(dims), data });
  }
  for (const sid of f.body) {
    const st = m.stmts[sid];
    const dims = st.indices.map(ix => A.value(ix.extent, shapes));
    if (dims.some(d => !(d >= 1))) throw new Error(`${fnName}: ${st.tensor} has an empty dimension`);
    const slots = new Map<string, number>();
    st.indices.forEach((ix, i) => slots.set(ix.name, i));
    let nslots = st.indices.length;
    const compile = (eid: string, sc: ReadonlyMap<string, number>): Code => {
      const e: Expr = m.exprs[eid];
      switch (e.op) {
        case 'num': {
          const v = round(e.value);
          return () => v;
        }
        case 'shape': {
          const v = round(shapes[e.name]);
          return () => v;
        }
        case 'ref': {
          const buf = tensors.get(`${e.kind}:${e.name}`)!;
          const ls = e.at.map(a => linear(a, sc));
          const { data, strides, dims: bd } = buf;
          return env => {
            let off = 0;
            for (let d = 0; d < ls.length; d++) {
              const i = at(ls[d], env);
              if (i < 0 || i >= bd[d]) throw new Error(`${fnName}: index ${i} out of bounds in ${st.tensor}`);
              off += strides[d] * i;
            }
            return data[off];
          };
        }
        case 'reduce': {
          const inner = new Map(sc);
          const axSlots = e.axes.map(ax => {
            inner.set(ax.name, nslots);
            return nslots++;
          });
          const ext = e.axes.map(ax => extentValue(ax.extent, shapes));
          const guards = (e.guard ?? []).map(g => ({ at: linear(g.at, inner), lt: A.value(g.lt, shapes) }));
          const body = compile(e.body, inner);
          const isSum = e.kind === 'sum';
          const n = axSlots.length;
          return env => {
            let acc = isSum ? 0 : -Infinity;
            if (ext.some(x => x <= 0)) return acc;
            for (let k = 0; k < n; k++) env[axSlots[k]] = 0;
            for (;;) {
              let pass = true;
              for (const g of guards)
                if (!(at(g.at, env) < g.lt)) {
                  pass = false;
                  break;
                }
              if (pass) {
                const v = body(env);
                acc = round(isSum ? acc + v : Math.max(acc, v));
              }
              let k = n - 1;
              while (k >= 0 && ++env[axSlots[k]] >= ext[k]) env[axSlots[k--]] = 0;
              if (k < 0) return acc;
            }
          };
        }
        default: {
          if ('b' in e) {
            const a = compile(e.a, sc),
              b = compile(e.b, sc),
              op = BIN[e.op];
            return env => round(op(a(env), b(env)));
          }
          const a = compile(e.a, sc),
            op = UN[e.op];
          return env => round(op(a(env)));
        }
      }
    };
    const code = compile(st.root, slots);
    const env = new Int32Array(nslots);
    const data = new Float64Array(size(dims));
    const r = dims.length;
    for (let k = 0; k < data.length; k++) {
      data[k] = code(env);
      let d = r - 1;
      while (d >= 0 && ++env[d] >= dims[d]) env[d--] = 0;
    }
    tensors.set(`stmt:${sid}`, { dims, strides: stridesOf(dims), data });
  }
  const out = tensors.get(`stmt:${f.returns}`)!;
  return { shape: [...out.dims], data: out.data };
}
