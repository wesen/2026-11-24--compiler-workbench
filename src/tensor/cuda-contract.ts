import {
  AnalysisManager,
  ContractError,
  createArtifact,
  defineIR,
  defineTransformation,
  defineType,
  differential,
  type Decided,
  type DifferentialEvidence,
} from '../framework/contracts/index.js';
import type { Artifact } from '../framework/core/types.js';
import { coordinate, cudaCases, seed } from './contract.js';
import { runCudaBatch } from './cuda-runtime.js';
import { emitCuda } from './cuda-source.js';
import type { BufferValue } from './evaluate.js';
import { TixIR } from './ir.js';
import { selectFunction, type Module } from './model.js';

interface CudaUnit {
  fn: string;
  source: string;
}

const CudaIR = defineIR<CudaUnit>({
  id: 'tensor.cuda-source',
  version: '1',
  description: 'Standalone CUDA translation unit for a Tix function',
  validate(value) {
    const unit = value as Partial<CudaUnit> | null;
    if (typeof unit?.fn !== 'string' || !unit.fn || typeof unit.source !== 'string' || !unit.source)
      throw Error('Invalid CUDA translation unit');
  },
});
const FunctionName = defineType<string>({
  id: 'tensor.function-name',
  version: '1',
  description: 'Name of the Tix function to lower',
  validate(name) {
    if (typeof name !== 'string' || !name) throw Error('Invalid Tix function name');
  },
});

export function cudaArtifact(fn: string, source: string): Artifact<CudaUnit> {
  return createArtifact(CudaIR, 'tix-cuda/' + fn, { fn, source });
}

// The relation is exact: the lowered function must give the current revision's f32 meaning bit for bit, signed
// zeros and infinities included (IRWB-019 F17). The emitter makes that possible: explicit round-to-nearest
// arithmetic, so nothing contracts, and exp, log and tanh in double, rounded, which equal Math.fround(Math.exp(x))
// and so on for all 2^32 f32 inputs on the GB10 (IRWB-019 diary step 23). NaN is compared as a class, because the
// GPU and V8 produce different NaN words (sqrt of -2^-149: 0x7fffffff against 0xffc00000).
function compare(expected: BufferValue, got: BufferValue) {
  if (expected.shape.length !== got.shape.length || expected.shape.some((n, i) => n !== got.shape[i]))
    return { ok: false, reason: 'Output shape differs' };
  if (expected.data.length !== got.data.length) return { ok: false, reason: 'Output length differs' };
  const f32 = (d: ArrayLike<number>) => (d instanceof Float32Array ? d : Float32Array.from(d));
  const a = f32(expected.data),
    b = f32(got.data);
  const wa = new Uint32Array(a.buffer, a.byteOffset, a.length),
    wb = new Uint32Array(b.buffer, b.byteOffset, b.length);
  const hex = (w: number) => '0x' + w.toString(16).padStart(8, '0');
  for (let i = 0; i < a.length; i++) {
    if (wa[i] === wb[i] || (Number.isNaN(a[i]) && Number.isNaN(b[i]))) continue;
    const at = coordinate(expected.shape, i);
    return { ok: false, reason: `At [${at}], expected ${a[i]} (${hex(wa[i])}), got ${b[i]} (${hex(wb[i])})` };
  }
  return { ok: true };
}

type CudaSample = ReturnType<typeof cudaCases>[number];

export function createCudaLowering(profile: string, executeBatch: typeof runCudaBatch = runCudaBatch) {
  const fuseOption = defineType<boolean>({
    id: 'tensor.cuda-fuse',
    version: '1',
    description: 'Enable checked fusion scheduling',
    validate(value) {
      if (typeof value !== 'boolean') throw Error('Expected a fusion switch');
    },
  });
  const inputs = { baseline: TixIR, fn: FunctionName, fuse: fuseOption };
  const outputs = { subject: CudaIR };
  const ports = { baseline: TixIR, fn: FunctionName, ...outputs };
  const invariant = differential<typeof ports, CudaSample, BufferValue>({
    id: 'tensor.cuda-meaning',
    version: '2',
    description:
      'Compare the lowered CUDA function to its current Tix f32 meaning, bit for bit (NaN as a class)',
    inputs: ports,
    baseline: 'baseline',
    subject: 'subject',
    // The recipe is shape-dependent and supplies its whole eligible case set.
    count: 1,
    seed,
    cases: ({ baseline, fn }, random) => {
      const samples = cudaCases(selectFunction(baseline.value, fn), random);
      if (!samples.length) throw Error('No eligible CUDA check cases for ' + fn);
      return samples;
    },
    run: (side, _artifact, sample) => {
      if (side === 'baseline') return sample.reference;
      throw Error('CUDA checks require the batch executor');
    },
    compare,
    describeCase: ({ fn, shapeValues, stream }) => ({ fn, shapeValues, stream, seed }),
    baselineKey: ({ baseline, fn }) => JSON.stringify([baseline.revision, fn]),
    subjectKey: (_artifact, _case, { subject }) => JSON.stringify([subject.revision, profile]),
    async decide({ baseline, fn, subject }, cases, todo) {
      if (subject.value.fn !== fn)
        return todo.map(() => ({ v: 'disagree', reason: 'CUDA function differs' }));
      const pending = todo.map(i => cases[i]);
      const results = await executeBatch(
        subject.value.source,
        selectFunction(baseline.value, fn),
        pending.map(c => c.inputs),
      );
      if (results.length !== pending.length) throw Error('Wrong CUDA response case count');
      return pending.map((sample, i): Decided => {
        const result = compare(sample.reference, results[i]);
        return result.ok ? { v: 'agree' } : { v: 'disagree', reason: result.reason! };
      });
    },
  });
  const pass = defineTransformation({
    id: 'tensor.lower-cuda',
    version: '2',
    description: 'Lower a Tix function to CUDA and check the candidate on the GPU',
    inputs,
    outputs,
    cache: 'never',
    ensures: [
      {
        invariant,
        bindings: {
          baseline: { from: 'inputs', port: 'baseline' },
          fn: { from: 'inputs', port: 'fn' },
          subject: { from: 'outputs', port: 'subject' },
        },
      },
    ],
    run(_ctx, { baseline, fn, fuse }) {
      return { outputs: { subject: cudaArtifact(fn, emitCuda(selectFunction(baseline.value, fn), fuse)) } };
    },
  });

  return async (baseline: Artifact<Module>, fn: string, candidate?: Artifact<CudaUnit>, fuse = true) => {
    const relation = 'exact' as const;
    const manager = new AnalysisManager();
    try {
      if (candidate) await manager.verifyTransformation({ baseline, fn, fuse }, { subject: candidate }, pass);
      else await manager.execute(pass, { baseline, fn, fuse });
      return { accepted: true, relation };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ContractError && error.code === 'postcondition') {
        const checks = manager.snapshot().executions.at(-1)?.checks;
        const evidence = checks?.find(check => check.phase === 'ensures')?.evidence as
          | DifferentialEvidence
          | undefined;
        const first = evidence?.counterexamples[0];
        const reason = first ? `${JSON.stringify(first.case)}: ${first.reason}` : message;
        return { accepted: false, relation, reason };
      }
      return { accepted: false, relation, reason: 'CUDA evidence unavailable: ' + message };
    }
  };
}

export const checkCudaLowering = createCudaLowering('cuda-remote:sm_121:-O3');
