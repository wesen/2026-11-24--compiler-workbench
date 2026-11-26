import {
  AnalysisManager,
  createArtifact,
  defineIR,
  defineTransformation,
  defineType,
  differential,
  seededRandom,
  type Decided,
  type DifferentialEvidence,
} from '../framework/contracts/index.js';
import { allowedError, sampleSeed, sampleValue } from './contract.js';
import { cudaAbi, cudaProfile, emitCuda } from './cuda-emit.js';
import { runCudaBatch, type CudaInputs, type CudaResult, type CudaTarget } from './cuda-run.js';
import { evaluate, OutsideSample, size, type BufferValue } from './evaluate.js';
import type { TixProgram } from './index.js';
import { TixIR } from './ir.js';
import { plain, value, type Fn } from './model.js';

interface CudaUnit {
  fn: string;
  source: string;
  abiVersion: number;
  buildProfile: string;
}
const CudaIR = defineIR<CudaUnit>({
  id: 'tensor.cuda-source',
  version: '1',
  description: 'Terminal CUDA translation unit for one Tix function',
  validate(value: unknown) {
    const u = value as CudaUnit;
    if (
      typeof u?.fn !== 'string' ||
      typeof u.source !== 'string' ||
      !u.source ||
      u.abiVersion !== cudaAbi ||
      u.buildProfile !== cudaProfile
    )
      throw Error('Invalid CUDA translation unit');
  },
});
const FunctionName = defineType<string>({
  id: 'tensor.cuda-function',
  version: '1',
  description: 'Name of selected Tix function',
  validate(value: unknown) {
    if (typeof value !== 'string' || !value) throw Error('Expected Tix function name');
  },
});
const Target = defineType<CudaTarget>({
  id: 'tensor.cuda-target',
  version: '1',
  description: 'Configured host and compiler path',
  validate(value: unknown) {
    const t = value as CudaTarget;
    if (typeof t?.host !== 'string' || typeof t.nvcc !== 'string') throw Error('Invalid CUDA target');
  },
});

interface Sample {
  inputs: CudaInputs;
  reference: BufferValue;
  description: { fn: string; bindings: Record<string, number>; stream: string; seed: number };
}

function cases(fn: Fn, random: () => number): Sample[] {
  const symbols = [
    ...new Set(fn.params.flatMap(p => p.shape.map(plain).filter((s): s is string => s !== undefined))),
  ].sort();
  const shapes = [1, 3, 4, 7].map(n => symbols.map(() => n));
  shapes.push(symbols.map((_, i) => [3, 5, 7][i % 3]));
  // Each zero in isolation can expose an empty reduction without emptying its result.
  shapes.push(
    symbols.map(() => 0),
    ...symbols.map((_, j) => symbols.map((_, i) => (i === j ? 0 : 3))),
  );
  const seen = new Set<string>(),
    out: Sample[] = [];
  for (const dims of shapes) {
    const key = JSON.stringify(dims);
    if (seen.has(key)) continue;
    seen.add(key);
    const env = new Map(symbols.map((s, i) => [s, dims[i]]));
    const parameters = fn.params.map(p => p.shape.map(d => value(d, env)));
    if (parameters.some(s => s.some(x => !Number.isSafeInteger(x) || x < 0) || size(s) > 4096)) continue;
    for (const stream of ['signed', 'positive', 'half-ulp', 'zero']) {
      const inputs: CudaInputs = Object.create(null);
      fn.params.forEach((p, j) => {
        const shape = parameters[j];
        const data = Float32Array.from({ length: size(shape) }, (_, i) => sampleValue(stream, i, random));
        inputs[p.name] = { shape, data };
      });
      try {
        const reference = evaluate(fn, inputs, 'f64', true);
        out.push({
          inputs,
          reference,
          description: { fn: fn.name, bindings: Object.fromEntries(env), stream, seed: sampleSeed },
        });
      } catch (error) {
        if (!(error instanceof OutsideSample)) throw error;
      }
    }
  }
  if (!out.length) throw Error(`No eligible CUDA lowering case for ${fn.name}`);
  return out;
}

function coordinate(shape: number[], i: number) {
  const coord = [...shape];
  for (let d = shape.length - 1; d >= 0; --d) {
    coord[d] = i % shape[d];
    i = Math.floor(i / shape[d]);
  }
  return coord;
}

function compare(reference: BufferValue, result: CudaResult): Decided {
  if (reference.shape.length !== result.shape.length || reference.shape.some((d, i) => d !== result.shape[i]))
    return {
      v: 'disagree',
      reason: `Output shape differs: expected [${reference.shape}], got [${result.shape}]`,
    };
  if (reference.data.length !== result.data.length) return { v: 'disagree', reason: 'Output length differs' };
  for (let i = 0; i < reference.data.length; ++i) {
    const r = reference.data[i],
      g = result.data[i];
    const allowed = allowedError(r);
    const ok = Number.isFinite(r) ? Number.isFinite(g) && Math.abs(g - r) <= allowed : Object.is(g, r);
    if (!ok)
      return {
        v: 'disagree',
        reason: `at [${coordinate(reference.shape, i)}] expected ${r}, got ${g}, allowed ${Number.isFinite(r) ? allowed : 'same nonfinite class/sign'}`,
      };
  }
  return { v: 'agree' };
}

export function selectFn(module: TixProgram['current']['value'], name: string): Fn {
  const fn = module.functions.find(f => f.name === name);
  if (!fn) throw Error(`Unknown function ${name}`);
  return fn;
}

type Batch = (...args: Parameters<typeof runCudaBatch>) => Promise<{ results: CudaResult[] }>;

// Injection is internal (offline batching tests and a real CUDA falsifier).
export function createCudaLowering(batch: Batch = runCudaBatch, emit: (fn: Fn) => string = emitCuda) {
  const ports = { baseline: TixIR, subject: CudaIR, fn: FunctionName, target: Target };
  const meaning = differential<typeof ports, Sample, CudaResult>({
    id: 'tensor.cuda-meaning',
    version: '1',
    description: 'Compare a remote CUDA batch against the origin f64 evaluator',
    inputs: ports,
    baseline: 'baseline',
    subject: 'subject',
    count: 1,
    seed: sampleSeed,
    // count is a positive hint; the finite shape/stream suite determines the actual count.
    cases: ({ baseline, fn }, random) => cases(selectFn(baseline.value, fn), random),
    baselineKey: ({ baseline, fn }) => JSON.stringify([baseline.revision, fn]),
    subjectKey: (subject, _case, { target }) =>
      JSON.stringify([(subject as { revision: string }).revision, target.host, target.nvcc]),
    describeCase: s => s.description,
    run() {
      throw Error('CUDA meaning must use a batch');
    },
    compare: (expected, observed) => compare(expected, observed).v === 'agree',
    async decide({ baseline, subject, fn, target }, samples, todo) {
      const selected = selectFn(baseline.value, fn);
      const { results } = await batch(
        subject.value.source,
        selected,
        todo.map(i => samples[i].inputs),
        target,
      );
      if (results.length !== todo.length || todo.some((_, k) => !results[k]))
        throw Error('Incomplete CUDA batch');
      return todo.map((i, k) => compare(samples[i].reference, results[k]));
    },
  });
  const lower = defineTransformation({
    id: 'tensor.lower-cuda',
    version: '1',
    description: 'Emit a checked CUDA source artifact',
    inputs: { input: TixIR, origin: TixIR, fn: FunctionName, target: Target },
    outputs: { output: CudaIR },
    cache: 'never',
    ensures: [
      {
        invariant: meaning,
        bindings: {
          baseline: { from: 'inputs', port: 'origin' },
          subject: { from: 'outputs', port: 'output' },
          fn: { from: 'inputs', port: 'fn' },
          target: { from: 'inputs', port: 'target' },
        },
      },
    ],
    run(_ctx, { input, origin, fn }) {
      const current = selectFn(input.value, fn),
        baseline = selectFn(origin.value, fn);
      const signature = (f: Fn) => JSON.stringify([f.params, f.shape]);
      if (signature(current) !== signature(baseline)) throw Error(`Changed signature for ${fn}`);
      const source = emit(current);
      return {
        outputs: {
          output: createArtifact(CudaIR, `cuda/${fn}`, {
            fn,
            source,
            abiVersion: cudaAbi,
            buildProfile: cudaProfile,
          }),
        },
      };
    },
  });
  return async (program: TixProgram, fn: string, target: CudaTarget) => {
    const manager = new AnalysisManager();
    try {
      const { execution } = await manager.execute(lower, {
        input: program.current,
        origin: program.origin,
        fn,
        target,
      });
      const evidence = execution.checks.find(c => c.phase === 'ensures')?.evidence as DifferentialEvidence;
      return { accepted: true, relation: 'tolerance' as const, evidence };
    } catch (error) {
      const checks = manager.snapshot().executions.at(-1)?.checks ?? [];
      const evidence = checks.find(c => c.phase === 'ensures' && !c.ok)?.evidence as
        | DifferentialEvidence
        | undefined;
      const cx = evidence?.counterexamples[0];
      const reason = cx
        ? `${JSON.stringify(cx.case)}: ${cx.reason}`
        : error instanceof Error
          ? error.message
          : String(error);
      return { accepted: false, relation: 'tolerance' as const, reason, evidence };
    }
  };
}
