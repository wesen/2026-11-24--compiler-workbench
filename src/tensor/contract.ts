import {
  differential,
  differentialSpec,
  runDifferential,
  seededRandom,
  type CheckResult,
} from '../framework/contracts/index.js';
import type { Artifact } from '../framework/core/types.js';
import { evaluate, OutsideSample, size, type Inputs, type BufferValue } from './evaluate.js';
import { TixIR } from './ir.js';
import { plain, value, type Fn, type Module } from './model.js';

type Relation = 'exact' | 'tolerance';
export interface Sample {
  fn: string;
  shapeValues: number[];
  stream: string;
  inputs: Inputs;
  reference: BufferValue;
}
const seed = 20,
  half = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24];
export function meaningCases(
  fn: Fn,
  baseline: Fn,
  relation: Relation,
  random: () => number,
  zeroAxes = false,
): Sample[] {
  const symbols = [
    ...new Set(fn.params.flatMap(p => p.shape.map(plain).filter((n): n is string => !!n))),
  ].sort();
  const seen = new Set<string>(),
    out: Sample[] = [];
  const assignments = [1, 3, 4, 7, 'mixed'].map(n =>
    symbols.map((_, i) => (typeof n === 'string' ? [3, 5, 7][i % 3] : n)),
  );
  if (zeroAxes) assignments.push(...symbols.map((_, j) => symbols.map((_, i) => (i === j ? 0 : 3))));
  for (const shapeValues of assignments) {
    const key = JSON.stringify(shapeValues);
    if (seen.has(key)) continue;
    seen.add(key);
    const dims = new Map(symbols.map((s, i) => [s, shapeValues[i]]));
    const shapes = fn.params.map(p => p.shape.map(d => value(d, dims)));
    if (shapes.some(s => s.some(x => x < 0) || size(s) > 4096)) continue;
    for (const stream of ['signed', 'positive', 'half-ulp', ...(relation === 'exact' ? ['zero'] : [])]) {
      const inputs: Inputs = Object.create(null);
      fn.params.forEach((p, j) => {
        const shape = shapes[j];
        const data = Float32Array.from({ length: size(shape) }, (_, i) => {
          switch (stream) {
            case 'signed':
              return 2 * random() - 1;
            case 'positive':
              return 0.25 + 0.75 * random();
            case 'zero':
              return i % 2 ? -0 : 0;
            default:
              return half[i % half.length];
          }
        });
        inputs[p.name] = { shape, data };
      });
      try {
        const ref = evaluate(fn, inputs, relation === 'exact' ? 'f32' : 'f64', true);
        if (relation === 'tolerance' && !ref.data.every(Number.isFinite)) continue;
        // Extra empty-shape probes cannot by themselves witness an otherwise non-comparable function.
        if (zeroAxes && shapeValues.includes(0) && !ref.data.length && !out.length) continue;
        out.push({
          fn: fn.name,
          shapeValues,
          stream,
          inputs,
          reference: fn === baseline ? ref : evaluate(baseline, inputs, 'f32'),
        });
      } catch (error) {
        if (!(error instanceof OutsideSample)) throw error;
      }
    }
  }
  return out;
}
export function compare(ref: BufferValue, got: BufferValue, relation: Relation) {
  if (JSON.stringify(ref.shape) !== JSON.stringify(got.shape))
    return { ok: false, reason: 'Output shape differs' };
  const words = (b: BufferValue) => new Uint32Array(b.data.buffer, b.data.byteOffset, b.data.length);
  const a = relation === 'exact' ? words(ref) : ref.data,
    b = relation === 'exact' ? words(got) : got.data;
  for (let i = 0; i < a.length; i++) {
    const allowed = 2e-6 + 2e-5 * Math.abs(a[i]);
    if (relation === 'exact' ? a[i] !== b[i] : !Number.isFinite(b[i]) || Math.abs(a[i] - b[i]) > allowed) {
      let k = i;
      const coord = ref.shape.map(() => 0);
      for (let j = coord.length - 1; j >= 0; j--) {
        coord[j] = k % ref.shape[j];
        k = Math.floor(k / ref.shape[j]);
      }
      return {
        ok: false,
        reason: `at [${coord}] expected ${a[i]}, got ${b[i]}, allowed ${relation === 'exact' ? 0 : allowed}`,
      };
    }
  }
  return { ok: true };
}
function signature(m: Module) {
  return JSON.stringify(m.functions.map(({ name, params, shape }) => ({ name, params, shape })));
}
export function meaningGate(origin: Artifact<Module>, relation: Relation) {
  return (before: Artifact<Module>, candidate: Artifact<Module>): CheckResult => {
    if (signature(origin.value) !== signature(candidate.value))
      return { ok: false, reason: 'Function signatures differ' };
    const baseline = relation === 'exact' ? before : origin;
    const samples: Sample[] = [];
    const random = seededRandom(seed);
    for (const [i, fn] of origin.value.functions.entries()) {
      const group = meaningCases(fn, baseline.value.functions[i], relation, random);
      if (!group.length) return { ok: false, reason: 'No comparable case for ' + fn.name };
      samples.push(...group);
    }
    const ports = { baseline: TixIR, subject: TixIR };
    const invariant = differential<typeof ports, Sample, BufferValue>({
      id: 'tensor.meaning.' + relation,
      version: '1',
      description: 'Compare returned tensor on origin-derived cases',
      inputs: ports,
      baseline: 'baseline',
      subject: 'subject',
      seed,
      count: samples.length,
      cases: () => samples,
      run: (side, artifact, s) =>
        side === 'baseline'
          ? s.reference
          : evaluate(artifact.value.functions.find(f => f.name === s.fn)!, s.inputs, 'f32'),
      compare: (a, b) => compare(a, b, relation),
      describeCase: ({ fn, shapeValues, stream }) => ({ fn, shapeValues, stream, seed }),
    });
    const evidence = runDifferential(differentialSpec(invariant), { baseline, subject: candidate });
    return { ok: evidence.status === 'agree', reason: evidence.counterexamples[0]?.reason, evidence };
  };
}
