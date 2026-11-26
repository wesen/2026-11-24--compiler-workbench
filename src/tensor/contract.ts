import { differential, differentialSpec, runDifferential } from '../framework/contracts/differential.js';
import type { Artifact } from '../framework/core/types.js';
import { evaluate, product, type Inputs, type Tensor } from './evaluate.js';
import { Indexed } from './ir.js';
import { children, value, type Expr, type Fn, type Module } from './model.js';
export type Relation = 'exact' | 'tolerance';
const ports = { origin: Indexed, baseline: Indexed, candidate: Indexed };
interface Sample {
  fn: string;
  binding: Record<string, number>;
  pattern: string;
  inputs: Inputs | null;
}
const sizes = [1, 3, 4, 5, 9],
  witness = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 0, 0, 0.25];
function* samples(f: Fn, random: () => number): Generator<Sample> {
  const names = [...new Set(f.params.flatMap(p => p.dims.flatMap(d => d.t.map(([n]) => n))))].sort(),
    seen = new Set<string>();
  let kept = false;
  for (let t = 0; t < 10; t++) {
    const env = new Map(names.map((n, j) => [n, sizes[(t + (t < 5 ? 0 : j)) % 5]])),
      binding = Object.fromEntries(env),
      key = JSON.stringify(binding);
    if (seen.has(key)) continue;
    seen.add(key);
    const shape = (p: { dims: Fn['result'] }) => p.dims.map(d => value(d, env));
    const valid = (n: number) => Number.isSafeInteger(n) && n > 0;
    if ([...f.params, ...f.defs].some(p => !shape(p).every(valid) || product(shape(p)) > 65536)) continue;
    function cost(e: Expr): number {
      const count =
        e.op === 'reduce'
          ? product(
              e.axes.map(a => {
                const n = value(a.extent, env);
                return valid(n) ? n : Infinity;
              }),
            )
          : 1;
      return 1 + count * children(e).reduce((a, b) => a + cost(b), 0);
    }
    if (f.defs.reduce((n, s) => n + product(shape(s)) * cost(s.rhs), 0) > 1e6) continue;
    const patterns = ['coordinate', 'random'];
    if (f.params.length === 1 && shape(f.params[0]).at(-1) === 9) patterns.push('witness');
    for (const pattern of patterns) {
      const inputs: Inputs = Object.create(null);
      for (const [j, p] of f.params.entries()) {
        const dims = shape(p),
          data = new Float32Array(product(dims));
        for (let i = 0; i < data.length; i++)
          data[i] =
            pattern === 'witness'
              ? witness[i % 9]
              : p.name === 'eps' && dims.length === 1 && dims[0] === 1
                ? 0.001
                : pattern === 'random'
                  ? (1 + random()) / 2
                  : (1 + ((i * 17 + j * 7) % 61)) / 64;
        inputs[p.name] = { shape: dims, data };
      }
      kept = true;
      yield { fn: f.name, binding, pattern, inputs };
    }
  }
  if (!kept) yield { fn: f.name, binding: {}, pattern: 'no eligible shape', inputs: null };
}
export function compare(relation: Relation, a: Tensor, b: Tensor) {
  if (
    a.shape.length !== b.shape.length ||
    a.shape.some((n, i) => n !== b.shape[i]) ||
    a.data.length !== b.data.length
  )
    return { ok: false, reason: 'output shape mismatch' };
  if (relation === 'exact') {
    const words = (t: Tensor) => new Uint32Array(t.data.buffer, t.data.byteOffset, t.data.length);
    const x = words(a),
      y = words(b);
    for (let i = 0; i < x.length; i++)
      if (x[i] !== y[i]) return { ok: false, reason: `lane ${i}: words ${x[i]} vs ${y[i]}` };
  } else
    for (let i = 0; i < a.data.length; i++) {
      const x = a.data[i],
        y = b.data[i],
        err = Math.abs(x - y),
        bound = 2e-6 + 2e-5 * Math.abs(x);
      if (!Number.isFinite(x) || !Number.isFinite(y) || err > bound)
        return { ok: false, reason: `lane ${i}: |${x} - ${y}| = ${err}, bound ${bound}` };
    }
  return { ok: true };
}
function meaning(relation: Relation) {
  return differential<typeof ports, Sample, Tensor | null>({
    id: `tix.${relation}`,
    version: '1',
    description: `Tensor ${relation} on origin-derived cases`,
    inputs: ports,
    baseline: 'baseline',
    subject: 'candidate',
    count: 10,
    seed: 20,
    cases: ({ origin }, rng) => origin.value.flatMap(f => [...samples(f, rng)]),
    describeCase: ({ fn, binding, pattern }) => ({ fn, binding, pattern }),
    run: (side, artifact, s) => {
      const f = artifact.value.find(f => f.name === s.fn);
      return f && s.inputs
        ? evaluate(f, s.inputs, side === 'baseline' && relation === 'tolerance' ? 'f64' : 'f32')
        : null;
    },
    compare: (a, b) =>
      a && b ? compare(relation, a, b) : { ok: false, reason: 'missing function or eligible shape' },
  });
}
const invariants = { exact: meaning('exact'), tolerance: meaning('tolerance') };
export function verify(
  relation: Relation,
  origin: Artifact<Module>,
  input: Artifact<Module>,
  candidate: Artifact<Module>,
) {
  const evidence = runDifferential(differentialSpec(invariants[relation]), {
    origin,
    baseline: relation === 'exact' ? input : origin,
    candidate,
  });
  return { ok: evidence.status === 'agree', evidence };
}
