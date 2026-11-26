import { canonical } from '../framework/core/data.js';
import { defineTransformation, differential, seededRandom } from '../framework/contracts/index.js';
import type { Artifact } from '../framework/core/types.js';
import type { IRGraph } from '../framework/ir/index.js';
import { constant, equal, evalAff, plain } from './affine.js';
import { Index, TixIR } from './ir.js';
import { evaluate, size, workBound, type Inputs, type Tensor } from './evaluate.js';

interface Call {
  fn: string;
  binding: Record<string, number>;
  profile: number;
  seed: number;
  unavailable?: true;
}
const symbolSchedule = [...[1, 4, 5, 7].map(k => [k]), [3, 5, 7], [5, 7, 3], [7, 3, 5]];
export function samples(ix: Index, random: () => number): Call[] {
  const out: Call[] = [];
  for (const fn of ix.graph.roots) {
    const params = ix.kids(fn, 'param'),
      syms = new Set(params.flatMap(id => ix.dims(id).map(plain)).filter((s): s is string => !!s)),
      seen = new Set<string>();
    for (const schedule of symbolSchedule) {
      const env = new Map([...syms].map((s, i) => [s, schedule[i % schedule.length]])),
        binding = Object.fromEntries(env),
        key = canonical(binding);
      if (seen.has(key)) continue;
      if (
        [...params, ...ix.kids(fn, 'stmt')].some(id => {
          const shape = ix.dims(id).map(d => evalAff(d, env));
          return shape.some(n => n <= 0) || size(shape) > 32768;
        }) ||
        workBound(ix, fn, env) > 2000000
      )
        continue;
      seen.add(key);
      for (let profile = 0; profile < 4; profile++)
        out.push({ fn, binding, profile, seed: Math.floor(random() * 2 ** 32) });
    }
    if (!seen.size) out.push({ fn, binding: {}, profile: 0, seed: 0, unavailable: true });
  }
  return out;
}
const witness = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24];
export function materialize(ix: Index, c: Call): Inputs {
  const env = new Map(Object.entries(c.binding)),
    rand = seededRandom(c.seed);
  return Object.fromEntries(
    ix.kids(c.fn, 'param').map((id, j) => {
      const dims = ix.dims(id),
        shape = dims.map(d => evalAff(d, env)),
        positive = dims.length === 1 && equal(dims[0], constant(1));
      const data = Float32Array.from({ length: size(shape) }, (_, i) => {
        const x =
          c.profile === 0
            ? 1
            : c.profile === 1
              ? (((i + j) % 17) - 8) / 8
              : c.profile === 2
                ? witness[(i % shape.at(-1)!) % 7]
                : 2 * rand() - 1;
        return positive ? 2 ** -10 + Math.abs(x) : x;
      });
      return [ix.name(id), { shape, data }];
    }),
  );
}
const cache = new WeakMap<IRGraph, { ix: Index; signature: string }>();
function info(a: Artifact<IRGraph>) {
  let x = cache.get(a.value);
  if (!x) {
    const ix = new Index(a.value),
      signature = canonical(
        ix.graph.roots.map(fn => [
          ix.name(fn),
          ix.kids(fn, 'param').map(id => [ix.name(id), ix.dims(id)]),
          ix.dims(fn),
        ]),
      );
    x = { ix, signature };
    cache.set(a.value, x);
  }
  return x;
}
const ports = { origin: TixIR, before: TixIR, candidate: TixIR };
const words = (x: Tensor) => new Uint32Array(x.data.buffer, x.data.byteOffset, x.data.length);
function gate(mode: 'exact' | 'tolerance') {
  const inv = differential<typeof ports, Call, Tensor | string>({
    id: `tensor.${mode}`,
    version: '1',
    description: `${mode} on origin-derived calls`,
    inputs: ports,
    baseline: mode === 'exact' ? 'before' : 'origin',
    subject: 'candidate',
    count: 4,
    seed: 7,
    cases: ({ origin }, random) => samples(info(origin).ix, random),
    describeCase: c => c,
    run: (side, a, c, { origin }) => {
      if (c.unavailable) return 'no admissible calls';
      const ref = info(origin),
        current = info(a);
      if (ref.signature !== current.signature) return 'signature mismatch';
      return evaluate(
        current.ix,
        c.fn,
        materialize(ref.ix, c),
        mode === 'tolerance' && side === 'baseline' ? 'f64' : 'f32',
        true,
      );
    },
    compare: (r, v) => {
      if (typeof r === 'string' || typeof v === 'string')
        return { ok: false, reason: typeof r === 'string' ? r : String(v) };
      if (canonical(r.shape) !== canonical(v.shape) || r.data.length !== v.data.length)
        return { ok: false, reason: 'shape mismatch' };
      if (mode === 'exact') {
        const a = words(r),
          b = words(v);
        for (let i = 0; i < a.length; i++)
          if (a[i] !== b[i])
            return { ok: false, reason: `[${i}]: 0x${a[i].toString(16)} != 0x${b[i].toString(16)}` };
      } else
        for (let i = 0; i < r.data.length; i++) {
          const ref = r.data[i],
            x = v.data[i],
            limit = 2e-5 + 2e-5 * Math.abs(ref);
          if (!Number.isFinite(ref) || !Number.isFinite(x) || Math.abs(ref - x) > limit)
            return { ok: false, reason: `[${i}]: observed ${x}, reference ${ref}, bound ${limit}` };
        }
      return true;
    },
  });
  return defineTransformation({
    id: `tensor.pass.${mode}`,
    version: '1',
    description: 'Sampled tensor meaning',
    inputs: { origin: TixIR, input: TixIR },
    outputs: { output: TixIR },
    ensures: [
      {
        invariant: inv,
        bindings: {
          origin: { from: 'inputs', port: 'origin' },
          before: { from: 'inputs', port: 'input' },
          candidate: { from: 'outputs', port: 'output' },
        },
      },
    ],
  });
}
export const exact = gate('exact'),
  tolerance = gate('tolerance');
