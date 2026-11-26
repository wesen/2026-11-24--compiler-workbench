import {
  AnalysisManager,
  defineIR,
  defineTransformation,
  defineType,
  differential,
  type DifferentialEvidence,
} from '../framework/contracts/index.js';
import { createArtifact } from '../framework/contracts/definitions.js';
import type { Artifact } from '../framework/core/types.js';
import { cudaEngine, runCudaBatch, type CudaEngine, type CudaInputs, type CudaResult } from './cuda-run.js';
import { cudaProtocol, emitCuda, shapeSymbols } from './cuda-source.js';
import { evaluate, OutsideSample, type BufferValue } from './evaluate.js';
import { TixIR } from './ir.js';
import type { Module } from './model.js';
import { sampleInputs, type SampleStream } from './samples.js';

const FnName = defineType<string>({
  id: 'tensor.selected-function',
  version: '1',
  description: 'Selected Tix function name',
  validate: name => {
    if (typeof name !== 'string' || !name.length) throw Error('Invalid function name');
  },
});
const Engine = defineType<CudaEngine>({
  id: 'tensor.cuda-engine',
  version: '1',
  description: 'Configured GB10 transport',
  validate: x => {
    const e = x as CudaEngine;
    if (
      !e ||
      typeof e.host !== 'string' ||
      typeof e.nvcc !== 'string' ||
      e.protocol !== cudaProtocol ||
      e.arch !== 'sm_121' ||
      e.flags !== '-O3'
    )
      throw Error('Invalid CUDA engine configuration');
  },
});
type TranslationUnit = { fn: string; target: 'sm_121'; protocol: number; source: string };
const CudaSourceIR = defineIR<TranslationUnit>({
  id: 'tensor.cuda-source',
  version: '1',
  description: 'Self-contained CUDA C translation unit',
  validate: x => {
    const c = x as TranslationUnit;
    if (
      !c ||
      typeof c.fn !== 'string' ||
      c.target !== 'sm_121' ||
      c.protocol !== cudaProtocol ||
      typeof c.source !== 'string' ||
      !c.source.length
    )
      throw Error('Invalid CUDA source artifact');
  },
});
export function selectedFunction(module: Module, name: string) {
  const fn = module.functions.find(f => f.name === name);
  if (!fn) throw Error('Unknown function ' + name);
  return fn;
}
const seed = 20;
const uniform = [0, 1, 3, 4, 7];
const streams: SampleStream[] = ['signed', 'positive', 'half-ulp', 'zero', 'subnormal'];
interface Sample {
  inputs: CudaInputs;
  shapeValues: number[];
  stream: SampleStream;
  ref: BufferValue;
  fallback?: BufferValue;
}
function samples(module: Module, name: string, random: () => number): Sample[] {
  const fn = selectedFunction(module, name);
  const symbols = shapeSymbols(fn);
  const mixed = symbols.map((_, i) => [3, 5, 7][i % 3]);
  const assignments = [
    ...uniform.map(n => symbols.map(() => n)),
    mixed,
    ...symbols.map((_, j) => mixed.map((n, i) => (i === j ? 0 : n))),
  ];
  const seen = new Set<string>();
  const out: Sample[] = [];
  for (const shapeValues of assignments) {
    const key = JSON.stringify(shapeValues);
    if (seen.has(key)) continue;
    seen.add(key);
    const dims = new Map(symbols.map((s, i) => [s, shapeValues[i]]));
    for (const stream of streams) {
      const inputs = sampleInputs(fn, dims, stream, random);
      if (!inputs) break;
      try {
        const ref = evaluate(fn, inputs, 'f64', true);
        const fallback = ref.data.every(Number.isFinite) ? undefined : evaluate(fn, inputs, 'f32', true);
        out.push({ inputs, shapeValues, stream, ref, fallback });
      } catch (error) {
        if (!(error instanceof OutsideSample)) throw error;
      }
    }
  }
  return out;
}

function compare(s: Sample, got: CudaResult) {
  const { shape, data } = s.ref;
  if (
    shape.length !== got.shape.length ||
    shape.some((n, i) => n !== got.shape[i]) ||
    data.length !== got.data.length
  )
    return { v: 'disagree', reason: `expected shape [${shape}], got [${got.shape}]` } as const;
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const want = Number.isFinite(r) ? r : s.fallback!.data[i];
    const actual = got.data[i];
    const allowed = 2e-6 + 2e-5 * Math.abs(want);
    if (
      Number.isFinite(want)
        ? Number.isFinite(actual) && Math.abs(actual - want) <= allowed
        : Object.is(actual, want)
    )
      continue;
    let index = i;
    const coord = shape.map(() => 0);
    for (let j = shape.length - 1; j >= 0; j--) {
      coord[j] = index % shape[j];
      index = Math.floor(index / shape[j]);
    }
    const baseline = Number.isFinite(r) ? 'f64' : 'f32 fallback';
    return {
      v: 'disagree',
      reason: `at [${coord}]: expected ${want} (${baseline}), got ${actual}; ${Number.isFinite(want) ? `allowed ${allowed}` : 'nonfinite class must match'}`,
    } as const;
  }
  return { v: 'agree' } as const;
}
const inputPorts = { baseline: TixIR, fn: FnName, engine: Engine };
const ports = { ...inputPorts, subject: CudaSourceIR };

function loweringContract(run: typeof runCudaBatch) {
  const invariant = differential<typeof ports, Sample, never>({
    id: 'tensor.cuda-tolerance',
    version: '1',
    description: 'Compare batched CUDA outputs with current Tix',
    inputs: ports,
    baseline: 'baseline',
    subject: 'subject',
    seed,
    count: uniform.length + 1, // Base shape assignments before per-axis zero cases.
    baselineKey: ({ baseline, fn }) => JSON.stringify([baseline.revision, fn, process.versions.v8]),
    subjectKey: (_subject, _case, { subject, engine }) => JSON.stringify([subject.revision, engine]),
    cases: ({ baseline, fn }, random) => samples(baseline.value, fn, random),
    describeCase: ({ shapeValues, stream }) => ({ shapeValues, stream, seed }),
    run: () => {
      throw Error('CUDA samples must be delegated as a batch');
    },
    compare: () => {
      throw Error('CUDA samples must be compared after the batch');
    },
    decide: async ({ baseline, subject, fn, engine }, cases, todo) => {
      const f = selectedFunction(baseline.value, fn);
      if (subject.value.fn !== fn) throw Error('Mismatched CUDA candidate function');
      const { records } = await run(
        subject.value.source,
        f,
        todo.map(id => ({ id, inputs: cases[id].inputs })),
        engine,
      );
      if (records.length !== todo.length) throw Error('Incomplete CUDA batch');
      return todo.map((id, i) => compare(cases[id], records[i]));
    },
  });
  return defineTransformation({
    id: 'tensor.lower-cuda',
    version: '1',
    description: 'Lower a Tix function to checked CUDA C',
    inputs: inputPorts,
    outputs: { subject: CudaSourceIR },
    cache: 'never',
    ensures: [
      {
        invariant,
        bindings: {
          baseline: { from: 'inputs', port: 'baseline' },
          fn: { from: 'inputs', port: 'fn' },
          engine: { from: 'inputs', port: 'engine' },
          subject: { from: 'outputs', port: 'subject' },
        },
      },
    ],
    run: (_ctx, { baseline, fn }) => ({
      outputs: { subject: unit(fn, emitCuda(selectedFunction(baseline.value, fn))) },
    }),
  });
}

function unit(fn: string, source: string) {
  return createArtifact<TranslationUnit>(CudaSourceIR, 'cuda-source', {
    fn,
    target: 'sm_121',
    protocol: cudaProtocol,
    source,
  });
}

/** Internal seam for checking an actual alternative translation unit or a fake batch transport in tests. */
export async function checkCudaPass(
  baseline: Artifact<Module>,
  fn: string,
  {
    engine = cudaEngine(),
    run = runCudaBatch,
    candidate,
  }: {
    engine?: CudaEngine;
    run?: typeof runCudaBatch;
    candidate?: string;
  } = {},
): Promise<{ accepted: boolean; relation: 'tolerance'; reason?: string }> {
  const manager = new AnalysisManager();
  const inputs = { baseline, fn, engine };
  const contract = loweringContract(run);
  try {
    if (candidate === undefined) await manager.execute(contract, inputs);
    else await manager.verifyTransformation(inputs, { subject: unit(fn, candidate) }, contract);
    return { accepted: true, relation: 'tolerance' };
  } catch (error) {
    const check = manager.snapshot().executions[0]?.checks.find(c => !c.ok);
    const evidence = check?.evidence as DifferentialEvidence | undefined;
    const counterexample = evidence?.counterexamples[0];
    const reason = counterexample
      ? `${fn}, ${JSON.stringify(counterexample.case)}: ${counterexample.reason}`
      : evidence?.total === 0
        ? `No eligible lowering cases for ${fn}`
        : error instanceof Error
          ? error.message
          : String(error);
    return { accepted: false, relation: 'tolerance', reason };
  }
}
