import { createHash } from 'node:crypto';
import {
  AnalysisManager,
  ContractError,
  defineInvariant,
  defineTransformation,
  defineType,
  runDifferentialAsync,
  type BatchDifferentialSpec,
} from '../framework/contracts/index.js';
import { compareMeaning, meaningCases, type Sample } from './contract.js';
import { runCudaBatch } from './cuda-run.js';
import { emitCuda, functionNamed } from './cuda-source.js';
import type { TixProgram } from './index.js';
import { TixIR } from './ir.js';

const Text = defineType<string>({
  id: 'tensor.text',
  version: '1',
  description: 'Function name or CUDA translation unit',
  validate(value) {
    if (typeof value !== 'string') throw Error('Expected text');
  },
});
const ports = { origin: TixIR, fn: Text, source: Text };
const target = { host: 'manuel@bling', device: 'NVIDIA GB10', major: 12, minor: 1, runtime: 13000 };
const version = '1'; // Includes nvcc 13.0.88, -O3 -arch=sm_121, runner/ABI and reference policy.
const meaning = defineInvariant({
  id: 'tensor.cuda.meaning',
  version,
  description: 'GPU output within the original Tix f64 budget',
  inputs: ports,
  async check(_, inputs) {
    const fn = functionNamed(inputs.origin.value, inputs.fn);
    const digest = createHash('sha256').update(inputs.source).digest('hex');
    const subjectKey = JSON.stringify([target, digest]);
    const seed = 20;
    const spec: BatchDifferentialSpec<typeof ports, Sample> = {
      id: 'tensor.cuda.meaning',
      version,
      description: 'Batched GB10 differential check',
      inputs: ports,
      baseline: 'origin',
      subject: 'source',
      count: 15,
      seed,
      cases: (_, random) => meaningCases(fn, fn, 'tolerance', random),
      baselineKey: () => JSON.stringify([inputs.origin.revision, fn.name]),
      subjectKey: () => subjectKey,
      describeCase: ({ fn, shapeValues, stream }) => ({ fn, shapeValues, stream, seed }),
      async decide(_, cases, todo) {
        const { results, engine } = await runCudaBatch(
          inputs.source,
          fn,
          todo.map(i => cases[i].inputs),
          { host: target.host },
        );
        if (
          engine.host !== target.host ||
          engine.device !== target.device ||
          engine.major !== target.major ||
          engine.minor !== target.minor ||
          engine.runtime !== target.runtime
        )
          throw Error('Unexpected CUDA engine ' + JSON.stringify(engine));
        return todo.map((i, j) => {
          const match = compareMeaning(cases[i].reference, results[j], 'tolerance');
          return match.ok ? { v: 'agree' } : { v: 'disagree', reason: match.reason! };
        });
      },
    };
    const evidence = await runDifferentialAsync(spec, inputs);
    const first = evidence.counterexamples[0];
    const reason = first
      ? JSON.stringify(first.case) + ' ' + first.reason
      : evidence.total === 0
        ? 'No comparable case for ' + fn.name
        : `${evidence.agree} cases agree`;
    return { ok: evidence.status === 'agree', reason, evidence: { ...evidence, digest, target } };
  },
});

export const cudaLowering = defineTransformation({
  id: 'tensor.lower.cuda',
  version,
  description: 'Lower one Tix function and verify its CUDA source',
  inputs: { current: TixIR, origin: TixIR, fn: Text },
  outputs: { source: Text },
  ensures: [
    {
      invariant: meaning,
      bindings: {
        origin: { from: 'inputs', port: 'origin' },
        fn: { from: 'inputs', port: 'fn' },
        source: { from: 'outputs', port: 'source' },
      },
    },
  ],
  run: (_, { current, fn }) => ({ outputs: { source: emitCuda(functionNamed(current.value, fn)) } }),
});

export async function checkLowering(
  program: TixProgram,
  fn: string,
): Promise<{ accepted: boolean; relation: 'exact' | 'tolerance'; reason?: string }> {
  try {
    await new AnalysisManager().execute(cudaLowering, {
      origin: program.origin,
      current: program.current,
      fn,
    });
    return { accepted: true, relation: 'tolerance' };
  } catch (e) {
    if (e instanceof ContractError && e.code === 'postcondition')
      return { accepted: false, relation: 'tolerance', reason: e.message };
    throw e;
  }
}
