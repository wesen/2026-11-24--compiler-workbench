import {
  differential,
  differentialSpec,
  runDifferential,
  seededRandom,
  type CheckResult,
} from '../framework/contracts/index.js';
import type { Artifact } from '../framework/core/types.js';
import { evaluate, OutsideSample, type Inputs, type BufferValue } from './evaluate.js';
import { TixIR } from './ir.js';
import type { Fn, Module } from './model.js';
import { sampleInputs, sampleSeed as seed, tolerance } from './samples.js';

type Relation = 'exact' | 'tolerance';
interface Sample {
  fn: string;
  shapeValues: number[];
  stream: string;
  inputs: Inputs;
  reference: BufferValue;
}
function cases(fn: Fn, baseline: Fn, relation: Relation, random: () => number): Sample[] {
  const out: Sample[] = [];
  for (const sample of sampleInputs(fn, random, { signedZero: relation === 'exact' })) {
    try {
      const ref = evaluate(fn, sample.inputs, relation === 'exact' ? 'f32' : 'f64', true);
      if (relation === 'tolerance' && !ref.data.every(Number.isFinite)) continue;
      out.push({
        ...sample,
        reference: fn === baseline ? ref : evaluate(baseline, sample.inputs, 'f32'),
      });
    } catch (error) {
      if (!(error instanceof OutsideSample)) throw error;
    }
  }
  return out;
}
function compare(ref: BufferValue, got: BufferValue, relation: Relation) {
  if (JSON.stringify(ref.shape) !== JSON.stringify(got.shape))
    return { ok: false, reason: 'Output shape differs' };
  const words = (b: BufferValue) => new Uint32Array(b.data.buffer, b.data.byteOffset, b.data.length);
  const a = relation === 'exact' ? words(ref) : ref.data,
    b = relation === 'exact' ? words(got) : got.data;
  for (let i = 0; i < a.length; i++) {
    const allowed = tolerance(a[i]);
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
      const group = cases(fn, baseline.value.functions[i], relation, random);
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
