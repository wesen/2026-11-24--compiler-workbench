import {
  defineInvariant,
  defineTransformation,
  differential,
  differentialSpec,
  runDifferential,
  seededRandom,
  type CheckResult,
  type Ports,
  type TransformationDefinition,
} from '../framework/contracts/index.js';
import type { Artifact } from '../framework/core/types.js';
import { evaluate, OutsideSample, size, type BufferValue } from './evaluate.js';
import type { CudaInputs } from './cuda-runtime.js';
import { TixIR } from './ir.js';
import { plain, value, type Fn, type Module } from './model.js';

/** How a Tix pass's output relates to its program's meaning: bit-identical, or within the f32 tolerance. */
export type Relation = 'exact' | 'tolerance';
interface Sample {
  fn: string;
  shapeValues: number[];
  stream: string;
  inputs: CudaInputs;
  reference: BufferValue;
}
export const seed = 20;
const half = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24];
function cases(fn: Fn, baseline: Fn, relation: Relation, random: () => number, cuda = false): Sample[] {
  const symbols = [
    ...new Set(fn.params.flatMap(p => p.shape.map(plain).filter((n): n is string => !!n))),
  ].sort();
  const seen = new Set<string>(),
    out: Sample[] = [];
  // 'mixed' gives every shape symbol a different size, so a pass that confuses two symbols changes some case
  // (a cycle of three sizes made symbols three apart equal in every case: IRWB-019 F21). The zero cases cover
  // empty extents.
  const distinct = [3, 5, 7, 2, 6, 4, 9, 8, 10, 11];
  const assignments = [1, 3, 4, 7, 'mixed'].map(n =>
    symbols.map((_, i) => (typeof n === 'number' ? n : (distinct[i] ?? i + 3))),
  );
  assignments.push(symbols.map(() => 0));
  for (const [zero] of symbols.entries()) assignments.push(symbols.map((_, i) => (i === zero ? 0 : 3)));
  for (const shapeValues of assignments) {
    const key = JSON.stringify(shapeValues);
    if (seen.has(key)) continue;
    seen.add(key);
    const dims = new Map(symbols.map((s, i) => [s, shapeValues[i]]));
    const shapes = fn.params.map(p => p.shape.map(d => value(d, dims)));
    if (shapes.some(s => s.some(x => x < 0) || size(s) > 4096)) continue;
    for (const stream of [
      'signed',
      'positive',
      'half-ulp',
      ...(relation === 'exact' || cuda ? ['zero'] : []),
    ]) {
      const inputs: CudaInputs = Object.create(null);
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
        if (relation === 'tolerance' && !cuda && !ref.data.every(Number.isFinite)) continue;
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
// The lowering's cases: references are the current revision's f32 meaning (IRWB-019 F17).
export function cudaCases(fn: Fn, random: () => number): Sample[] {
  return cases(fn, fn, 'exact', random, true);
}

export function coordinate(shape: number[], offset: number): number[] {
  const coord = shape.map(() => 0);
  for (let i = coord.length - 1; i >= 0; i--) {
    coord[i] = offset % shape[i];
    offset = Math.floor(offset / shape[i]);
  }
  return coord;
}

function compare(ref: BufferValue, got: BufferValue, relation: Relation) {
  if (JSON.stringify(ref.shape) !== JSON.stringify(got.shape))
    return { ok: false, reason: 'Output shape differs' };
  const words = (b: BufferValue) => new Uint32Array(b.data.buffer, b.data.byteOffset, b.data.length);
  const a = relation === 'exact' ? words(ref) : ref.data,
    b = relation === 'exact' ? words(got) : got.data;
  for (let i = 0; i < a.length; i++) {
    const allowed = 2e-6 + 2e-5 * Math.abs(a[i]);
    if (relation === 'exact' ? a[i] !== b[i] : !Number.isFinite(b[i]) || Math.abs(a[i] - b[i]) > allowed) {
      const coord = coordinate(ref.shape, i);
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
      // empty-extent cases are compared, but only a case with every extent nonempty counts as coverage
      if (!group.some(c => c.shapeValues.every(v => v > 0)))
        return { ok: false, reason: 'No comparable case for ' + fn.name };
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

const gated = new Map<Relation, TransformationDefinition<Ports, Ports>>();
/**
 * IRWB-041-C: the meaning gate as a v6 contract, so it survives the strategy bridge.
 *
 * `applyNativePassSync` takes the gate as an argument, and a strategy plan applies passes through `passAlgorithm`,
 * which knows nothing of that argument, so a plan that runs a Tix pass checked nothing (R3 probe 02). Written as an
 * `ensures` invariant over the input, the origin and the output, the same gate travels with the pass as a contract,
 * and the bridge's existing `contract` / `contractInputs` options carry it.
 */
export function meaningGateContract(relation: Relation): TransformationDefinition<Ports, Ports> {
  const cached = gated.get(relation);
  if (cached) return cached;
  const invariant = defineInvariant({
    id: 'tensor.meaning-gate.' + relation,
    version: '1',
    description: 'The Tix meaning gate (' + relation + ') over the input, the origin and the output',
    inputs: { before: TixIR, origin: TixIR, after: TixIR },
    check: (_ctx, { before, origin, after }) => {
      const result = meaningGate(origin, relation)(before, after);
      // the gate's evidence has an `undefined` field, which the analysis manager refuses to record ("IR data cannot
      // contain undefined"), so it is passed through a JSON round trip: the one adaptation the gate needed
      return result.ok
        ? { ok: true, evidence: JSON.parse(JSON.stringify(result.evidence ?? null)) }
        : { ok: false, reason: result.reason };
    },
  });
  const contract = defineTransformation({
    id: 'tensor.gated.' + relation,
    version: '1',
    description: 'a Tix pass under its meaning gate (' + relation + ')',
    inputs: { input: TixIR, origin: TixIR },
    outputs: { output: TixIR },
    ensures: [
      {
        invariant,
        bindings: {
          before: { from: 'inputs', port: 'input' },
          origin: { from: 'inputs', port: 'origin' },
          after: { from: 'outputs', port: 'output' },
        },
      },
    ],
  });
  gated.set(relation, contract);
  return contract;
}
