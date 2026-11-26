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

function compare(expected: BufferValue, got: BufferValue) {
  if (expected.shape.length !== got.shape.length || expected.shape.some((n, i) => n !== got.shape[i]))
    return { ok: false, reason: 'Output shape differs' };
  if (expected.data.length !== got.data.length) return { ok: false, reason: 'Output length differs' };
  for (const [i, ref] of expected.data.entries()) {
    const actual = got.data[i];
    const tolerance = 2e-6 + 2e-5 * Math.abs(ref);
    const agrees = Number.isFinite(ref)
      ? Number.isFinite(actual) && Math.abs(actual - ref) <= tolerance
      : Object.is(actual, ref);
    if (!agrees) {
      const at = coordinate(expected.shape, i);
      const budget = Number.isFinite(ref) ? ` (tolerance ${tolerance})` : '';
      return { ok: false, reason: `At [${at}], expected ${ref}, got ${actual}${budget}` };
    }
  }
  return { ok: true };
}

type CudaSample = ReturnType<typeof cudaCases>[number];

export function createCudaLowering(profile: string, executeBatch: typeof runCudaBatch = runCudaBatch) {
  const inputs = { baseline: TixIR, fn: FunctionName };
  const outputs = { subject: CudaIR };
  const ports = { ...inputs, ...outputs };
  const invariant = differential<typeof ports, CudaSample, BufferValue>({
    id: 'tensor.cuda-meaning',
    version: '1',
    description: 'Compare the lowered CUDA function to its current Tix f64 meaning',
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
    version: '1',
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
    run(_ctx, { baseline, fn }) {
      return { outputs: { subject: cudaArtifact(fn, emitCuda(selectFunction(baseline.value, fn))) } };
    },
  });

  return async (baseline: Artifact<Module>, fn: string, candidate?: Artifact<CudaUnit>) => {
    const relation = 'tolerance' as const;
    const manager = new AnalysisManager();
    try {
      if (candidate) await manager.verifyTransformation({ baseline, fn }, { subject: candidate }, pass);
      else await manager.execute(pass, { baseline, fn });
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
