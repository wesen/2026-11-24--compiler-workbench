import {
  AnalysisManager,
  defineTransformation,
  defineType,
  differential,
  type Decided,
  type DifferentialEvidence,
} from '../framework/contracts/index.js';
import { fingerprint } from '../framework/core/data.js';
import type { Artifact } from '../framework/core/types.js';
import { sampleInputs } from './contract.js';
import { executeCuda, type CudaCase } from './cuda-run.js';
import { emitCuda } from './cuda-source.js';
import { evaluate, OutsideSample, type BufferValue } from './evaluate.js';
import { TixIR } from './ir.js';
import type { Fn, Module } from './model.js';

const seed = 20;
const assignments = [0, 1, 3, 4, 7, 'mixed'] as const;
const target = 'manuel@bling';
const compilerPolicy = 'cuda-13.0/sm_121/-O3';
const relation = 'tolerance' as const;

export function tixFunction(module: Module, fn: string): Fn {
  const f = module.functions.find(f => f.name === fn);
  if (!f) throw Error('Unknown function ' + fn);
  return f;
}

interface CudaSample extends CudaCase {
  shapeValues: number[];
  stream: string;
  f32: BufferValue;
  f64: BufferValue;
}

function cases(fn: Fn, random: () => number): CudaSample[] {
  const samples: CudaSample[] = [];
  for (const sample of sampleInputs(fn, random, assignments, true)) {
    try {
      const f32 = evaluate(fn, sample.inputs, 'f32', true);
      const f64 = evaluate(fn, sample.inputs, 'f64', true);
      samples.push({ ...sample, id: samples.length, f32, f64 });
    } catch (error) {
      if (!(error instanceof OutsideSample)) throw error;
    }
  }
  return samples;
}

const budget = (x: number) => 2e-6 + 2e-5 * Math.abs(x);
const display = (x: number) => (Object.is(x, -0) ? '-0' : String(x));

export function compareCuda(f32: BufferValue, f64: BufferValue, gpu: BufferValue): Decided {
  if (
    f32.shape.length !== gpu.shape.length ||
    f32.shape.some((dim, i) => dim !== gpu.shape[i]) ||
    f32.data.length !== gpu.data.length
  )
    return { v: 'disagree', reason: 'Output shape or size differs' };
  for (let i = 0; i < f32.data.length; i++) {
    const s = f32.data[i],
      r = f64.data[i],
      got = gpu.data[i];
    const useF64 = Number.isFinite(s) && Number.isFinite(r) && Math.abs(s - r) <= budget(r) / 2;
    const reference = useF64 ? r : s;
    const matches = Number.isFinite(reference)
      ? Number.isFinite(got) && Math.abs(got - reference) <= budget(reference)
      : Object.is(got, reference);
    const zeroSignMatches = s !== 0 || got !== 0 || Object.is(s, got);
    if (!matches || !zeroSignMatches) {
      let offset = i;
      const coordinate = [...f32.shape];
      for (let axis = coordinate.length - 1; axis >= 0; axis--) {
        coordinate[axis] = offset % f32.shape[axis];
        offset = Math.floor(offset / f32.shape[axis]);
      }
      return {
        v: 'disagree',
        reason: `at [${coordinate}] f32=${display(s)}, f64=${display(r)}, GPU=${display(got)} (${useF64 ? 'f64' : 'f32'} rule)`,
      };
    }
  }
  return { v: 'agree' };
}

function textType(id: string, description: string) {
  return defineType<string>({
    id,
    description,
    version: '1',
    validate(value) {
      if (typeof value !== 'string' || !value.length) throw Error('Expected ' + description);
    },
  });
}

const inputs = { input: TixIR, fn: textType('tensor.function-name', 'Tix function name') };
const outputs = { output: textType('tensor.cuda-source', 'CUDA source text') };
const ports = { ...inputs, ...outputs };

export function cudaLowering(emit = emitCuda, runBatch = executeCuda) {
  const invariant = differential<typeof ports, CudaSample, never>({
    id: 'tensor.cuda-agreement',
    version: '1',
    description: 'Compare a generated CUDA program against the current Tix revision on the GB10',
    inputs: ports,
    baseline: 'input',
    subject: 'output',
    seed,
    count: assignments.length * 4,
    cases: ({ input, fn }, random) => cases(tixFunction(input.value, fn), random),
    run() {
      throw Error('CUDA differential cases must run as a batch');
    },
    compare() {
      throw Error('CUDA differential cases must be compared as a batch');
    },
    describeCase: ({ shapeValues, stream }) => ({ shapeValues, stream, seed }),
    baselineKey: ({ input, fn }) => fingerprint([input.revision, fn]),
    subjectKey: output => fingerprint([output, target, compilerPolicy]),
    async decide({ input, fn, output }, samples, todo) {
      const batch = todo.map(i => samples[i]);
      const results = await runBatch(output, tixFunction(input.value, fn), batch, { host: target });
      if (results.length !== batch.length) throw Error('Incomplete CUDA results batch');
      return results.map((gpu, i) => compareCuda(batch[i].f32, batch[i].f64, gpu));
    },
  });
  return defineTransformation({
    id: 'tensor.lower-cuda',
    version: '1',
    description: 'Lower one Tix function to CUDA C and check its meaning',
    inputs,
    outputs,
    cache: 'never',
    run: (_ctx, { input, fn }) => ({ outputs: { output: emit(tixFunction(input.value, fn)) } }),
    ensures: [
      {
        invariant,
        bindings: {
          input: { from: 'inputs', port: 'input' },
          fn: { from: 'inputs', port: 'fn' },
          output: { from: 'outputs', port: 'output' },
        },
      },
    ],
  });
}

const lowering = cudaLowering();

export async function verifyCudaLowering(
  input: Artifact<Module>,
  fn: string,
  pass = lowering,
): Promise<{ accepted: boolean; relation: 'exact' | 'tolerance'; reason?: string }> {
  const manager = new AnalysisManager();
  try {
    await manager.execute(pass, { input, fn });
    return { accepted: true, relation };
  } catch (error) {
    const check = manager.snapshot().executions[0]?.checks[0];
    const evidence = check?.evidence as DifferentialEvidence | undefined;
    const first = evidence?.counterexamples[0];
    const reason = first
      ? `${fn} ${JSON.stringify(first.case)} ${first.reason}`
      : evidence?.total === 0
        ? 'No valid bounded sample for ' + fn
        : error instanceof Error
          ? error.message
          : String(error);
    return { accepted: false, relation, reason };
  }
}
