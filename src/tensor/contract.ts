import { differential, differentialSpec, runDifferential } from '../framework/contracts/differential.js';
import { defineTransformation } from '../framework/contracts/definitions.js';
import type { Artifact } from '../framework/core/types.js';
import { TensorIR } from './ir.js';
import { evalAff, symbols, type Aff, type Binder, type Expr, type Fn, type Program } from './model.js';
import { evaluate, size, type Inputs, type Tensor } from './evaluate.js';

export type Relation = 'exact' | 'tolerant';
const ports = { origin: TensorIR, baseline: TensorIR, candidate: TensorIR };
const patterns = ['signed', 'positive', 'ones', 'witness'] as const;
interface Sample {
  fn: string;
  sizes: number[];
  pattern: (typeof patterns)[number] | 'uncovered';
  inputs: Inputs;
  reference?: Tensor;
}
// Check a concrete origin iteration box before allocating any arrays or executing the sample.
function admitted(f: Fn, env: Map<string, number>) {
  const limit = 100_000;
  let work = 0,
    storage = 0,
    ok = true;
  const defs = new Map<string, number[]>();
  const bounds = new Map<string, number>();
  const extent = (a: Aff) => {
    const n = evalAff(a, env);
    if (!Number.isSafeInteger(n) || n < 0 || n > limit) ok = false;
    return n;
  };
  function iterations(axes: Binder[]) {
    for (const b of axes) bounds.set(b.id, extent(b.dim));
    return size(axes.map(b => bounds.get(b.id)!));
  }
  function walk(e: Expr, count: number) {
    work += count;
    if (e.tag === 'op') e.args.forEach(a => walk(a, count));
    if (e.tag === 'reduce') walk(e.body, count * iterations(e.axes));
    if (e.tag === 'load' && count > 0)
      e.subs.forEach((a, i) => {
        let lo = a.c,
          hi = a.c;
        for (const [k, c] of a.terms) {
          const end = c * (bounds.get(k)! - 1);
          lo += Math.min(0, end);
          hi += Math.max(0, end);
        }
        if (lo < 0 || hi >= defs.get(e.def)![i]) ok = false;
      });
  }
  for (const d of [...f.params, ...f.stmts]) {
    const shape = d.shape.map(extent);
    defs.set(d.id, shape);
    storage += size(shape);
  }
  for (const s of f.stmts) walk(s.body, iterations(s.axes));
  return ok && work <= limit && storage <= limit && size(defs.get(f.result)!) > 0;
}
function samples(origin: Program, random: () => number, relation: Relation): Sample[] {
  const cases: Sample[] = [];
  for (const f of origin.functions) {
    const keys = symbols(f);
    const seen = new Set<string>();
    const start = cases.length;
    for (const sizes of [
      ...[1, 3, 4, 5, 9].map(n => keys.map(() => n)),
      keys.map((_, i) => [2, 3, 5, 7, 9][i % 5]),
    ]) {
      const key = sizes.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const env = new Map(keys.map((k, i) => [k, sizes[i]]));
      if (!admitted(f, env)) continue;
      for (const pattern of patterns) {
        const inputs: Inputs = Object.create(null);
        for (const p of f.params) {
          const shape = p.shape.map(a => evalAff(a, env)),
            data = new Float32Array(size(shape));
          for (let i = 0; i < data.length; i++) {
            const j = i % 9;
            data[i] =
              pattern === 'signed'
                ? 2 * random() - 1
                : pattern === 'positive'
                  ? 0.25 + 0.75 * random()
                  : pattern === 'ones'
                    ? 1
                    : j === 0
                      ? 1
                      : j <= 3
                        ? 0
                        : 2 ** -24;
          }
          inputs[p.name] = { shape, data };
        }
        const sample: Sample = { fn: f.name, sizes, pattern, inputs };
        if (relation === 'tolerant') {
          sample.reference = evaluate(f, inputs, 'f64');
          if (!sample.reference.data.every(Number.isFinite)) continue;
        }
        cases.push(sample);
      }
    }
    // A missing function must fail even if other functions have many agreements.
    if (cases.length === start) cases.push({ fn: f.name, sizes: [], pattern: 'uncovered', inputs: {} });
  }
  return cases;
}
export function compareOutputs(a: Tensor, b: Tensor, relation: Relation) {
  if (
    a.shape.length !== b.shape.length ||
    a.shape.some((n, i) => n !== b.shape[i]) ||
    a.data.length !== b.data.length
  )
    return { ok: false, reason: 'return shape mismatch' };
  if (relation === 'exact') {
    const words = (x: Tensor) => new Uint32Array(x.data.buffer, x.data.byteOffset, x.data.length);
    const x = words(a),
      y = words(b);
    for (let i = 0; i < x.length; i++)
      if (x[i] !== y[i]) return { ok: false, reason: `element ${i}: expected bits ${x[i]}, got ${y[i]}` };
  } else
    for (let i = 0; i < a.data.length; i++) {
      const ref = a.data[i],
        got = b.data[i];
      if (!Number.isFinite(got) || !(Math.abs(ref - got) <= 2e-6 + 2e-5 * Math.abs(ref)))
        return { ok: false, reason: `element ${i}: reference ${ref}, got ${got}` };
    }
  return { ok: true };
}
function meaning(relation: Relation) {
  const invariant = differential<typeof ports, Sample, Tensor | null>({
    id: `tensor.${relation}`,
    version: '1',
    description: 'Sampled returned tensor relation',
    inputs: ports,
    baseline: 'baseline',
    subject: 'candidate',
    seed: 7,
    count: 24,
    cases: ({ origin }, rng) => samples(origin.value, rng, relation),
    describeCase: ({ fn, sizes, pattern }) => ({ fn, sizes, pattern }),
    run(side, artifact, c) {
      if (c.pattern === 'uncovered') return null;
      if (side === 'baseline' && relation === 'tolerant') return c.reference!;
      const f = artifact.value.functions.find(f => f.name === c.fn);
      return f ? evaluate(f, c.inputs, 'f32') : null;
    },
    compare: (a, b) =>
      a && b
        ? compareOutputs(a, b, relation)
        : { ok: false, reason: 'missing function or nonempty reference coverage' },
  });
  const basePort = relation === 'exact' ? 'input' : 'origin';
  const contract = defineTransformation({
    id: `tensor.check.${relation}`,
    version: '1',
    description: invariant.description,
    inputs: { origin: TensorIR, input: TensorIR },
    outputs: { output: TensorIR },
    ensures: [
      {
        invariant,
        bindings: {
          origin: { from: 'inputs', port: 'origin' },
          baseline: { from: 'inputs', port: basePort },
          candidate: { from: 'outputs', port: 'output' },
        },
      },
    ],
  });
  return {
    contract,
    check(origin: Artifact<Program>, input: Artifact<Program>, candidate: Artifact<Program>) {
      return runDifferential(differentialSpec(invariant), {
        origin,
        baseline: basePort === 'input' ? input : origin,
        candidate,
      });
    },
  };
}
export const gates = { exact: meaning('exact'), tolerant: meaning('tolerant') };
