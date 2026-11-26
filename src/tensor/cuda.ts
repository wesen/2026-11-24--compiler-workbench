import {
  AnalysisManager,
  createArtifact,
  defineIR,
  defineTransformation,
  defineType,
  differential,
  type Decided,
  type DifferentialEvidence,
} from '../framework/contracts/index.js';
import type { Artifact } from '../framework/core/types.js';
import type { TixProgram } from './index.js';
import { runCudaBatch, type CudaResult } from './cuda-io.js';
import { emitCuda, protocolVersion } from './cuda-source.js';
import { evaluate, OutsideSample, type BufferValue } from './evaluate.js';
import { TixIR } from './ir.js';
import { functionNamed, type Fn, type Module } from './model.js';
import { sampleInputs, sampleSeed, tolerance, type F32Inputs } from './samples.js';

interface TranslationUnit {
  fn: string;
  protocol: number;
  source: string;
}

const CudaSourceIR = defineIR<TranslationUnit>({
  id: 'tensor.cuda-source',
  version: '1',
  description: 'CUDA translation unit with the Tix case-file protocol',
  validate(value) {
    const unit = value as TranslationUnit;
    if (
      !unit ||
      typeof unit.fn !== 'string' ||
      typeof unit.source !== 'string' ||
      !unit.source ||
      unit.protocol !== protocolVersion
    )
      throw Error('Expected a Tix CUDA translation unit');
  },
});

const FunctionName = defineType<string>({
  id: 'tensor.function-name',
  version: '1',
  description: 'Tix function to lower',
  validate(name) {
    if (typeof name !== 'string' || !name) throw Error('Expected a function name');
  },
});

export function lowerCuda(input: Artifact<Module>, name: string): Artifact<TranslationUnit> {
  return createArtifact(CudaSourceIR, 'tix-cuda', {
    fn: name,
    protocol: protocolVersion,
    source: emitCuda(functionNamed(input.value, name)),
  });
}

export function cudaSource(program: TixProgram, fn: string): string {
  return lowerCuda(program.current, fn).value.source;
}

export async function runTixCuda(
  program: TixProgram,
  fn: string,
  inputs: F32Inputs,
  options?: { host?: string },
): Promise<CudaResult> {
  const source = cudaSource(program, fn);
  const {
    outputs: [{ shape, data, gpuMs }],
  } = await runCudaBatch(functionNamed(program.current.value, fn), source, [inputs], options);
  return { shape, data, gpuMs };
}

export function* loweringCases(fn: Fn, random: () => number) {
  for (const sample of sampleInputs(fn, random, { signedZero: true, zeroShape: true })) {
    try {
      const reference = evaluate(fn, sample.inputs, 'f64', true);
      if (reference.data.every(Number.isFinite)) yield { ...sample, reference };
    } catch (error) {
      if (!(error instanceof OutsideSample)) throw error;
    }
  }
}

function compare(ref: BufferValue, got: BufferValue): Decided {
  if (
    ref.shape.length !== got.shape.length ||
    ref.shape.some((n, i) => n !== got.shape[i]) ||
    ref.data.length !== got.data.length
  )
    return {
      v: 'disagree',
      reason: `Output shape or length differs: expected [${ref.shape}], got [${got.shape}]`,
    };
  for (let i = 0; i < ref.data.length; i++) {
    const r = ref.data[i];
    const g = got.data[i];
    const limit = tolerance(r);
    if (!Number.isFinite(g) || Math.abs(g - r) > limit) {
      let at = i;
      const coord = ref.shape.map(() => 0);
      for (let j = coord.length - 1; j >= 0; j--) {
        coord[j] = at % ref.shape[j];
        at = Math.floor(at / ref.shape[j]);
      }
      return { v: 'disagree', reason: `at [${coord}] f64 expected ${r}, GPU got ${g}, allowed ${limit}` };
    }
  }
  return { v: 'agree' };
}

const ports = { baseline: TixIR, subject: CudaSourceIR, fn: FunctionName };
type LoweringCase =
  ReturnType<typeof sampleInputs> extends Generator<infer Case> ? Case & { reference: BufferValue } : never;
const meaning = differential<typeof ports, LoweringCase, BufferValue>({
  id: 'tensor.cuda.meaning',
  version: '1',
  description: 'CUDA keeps the selected Tix function within the sampled f64 tolerance',
  inputs: ports,
  baseline: 'baseline',
  subject: 'subject',
  seed: sampleSeed,
  count: 24,
  cases({ baseline, fn }, random) {
    const cases = [...loweringCases(functionNamed(baseline.value, fn), random)];
    if (!cases.length) throw Error('No comparable case for ' + fn);
    return cases;
  },
  run() {
    throw Error('CUDA comparison requires a GPU batch');
  },
  compare(baseline, subject) {
    const result = compare(baseline, subject);
    return result.v === 'disagree' ? { ok: false, reason: result.reason } : result.v === 'agree';
  },
  baselineKey: ({ baseline, fn }) => baseline.revision + '/' + fn,
  subjectKey: (_candidate, _case, { subject }) => subject.revision,
  describeCase: ({ fn, shapeValues, stream }) => ({ fn, shapeValues, stream, seed: sampleSeed }),
  async decide({ baseline, subject, fn }, cases, todo) {
    const { outputs } = await runCudaBatch(
      functionNamed(baseline.value, fn),
      subject.value.source,
      todo.map(i => cases[i].inputs),
    );
    return todo.map((i, j) => compare(cases[i].reference, outputs[j]));
  },
});

export const cudaLowering = defineTransformation({
  id: 'tensor.cuda.lowering',
  version: '1',
  description: 'Lower Tix to checked CUDA C',
  inputs: { input: TixIR, fn: FunctionName },
  outputs: { output: CudaSourceIR },
  cache: 'never',
  ensures: [
    {
      invariant: meaning,
      bindings: {
        baseline: { from: 'inputs', port: 'input' },
        subject: { from: 'outputs', port: 'output' },
        fn: { from: 'inputs', port: 'fn' },
      },
    },
  ],
  run: (_, { input, fn }) => ({ outputs: { output: lowerCuda(input, fn) } }),
});

export async function checkLowering(
  program: TixProgram,
  fn: string,
): Promise<{ accepted: boolean; relation: 'exact' | 'tolerance'; reason?: string }> {
  const manager = new AnalysisManager();
  try {
    await manager.execute(cudaLowering, { input: program.current, fn });
    return { accepted: true, relation: 'tolerance' };
  } catch (error) {
    const checked = manager.snapshot().executions[0]?.checks[0];
    const evidence = checked?.evidence as DifferentialEvidence | undefined;
    const mismatch = evidence?.counterexamples[0];
    const reason = mismatch
      ? `${JSON.stringify(mismatch.case)}: ${mismatch.reason}`
      : (error as Error).message;
    return { accepted: false, relation: 'tolerance', reason };
  }
}
