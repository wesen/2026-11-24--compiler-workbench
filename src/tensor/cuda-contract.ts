import {
  AnalysisManager,
  createArtifact,
  defineIR,
  defineTransformation,
  defineType,
  differential,
  type DifferentialEvidence,
} from '../framework/contracts/index.js';
import { cases, compare, type Sample } from './contract.js';
import { TixIR } from './ir.js';
import { runBatch } from './cuda-run.js';
import { cudaSource } from './cuda-source.js';
import type { TixProgram } from './index.js';
import type { BufferValue } from './evaluate.js';

function stringValue(v: unknown): asserts v is string {
  if (typeof v !== 'string') throw Error('Expected string');
}
const cuda = defineIR<string>({
  id: 'tensor.cuda.source',
  version: '1',
  description: 'Complete CUDA translation unit',
  validate: stringValue,
});
const name = defineType<string>({
  id: 'tensor.function-name',
  version: '1',
  description: 'Selected function',
  validate: stringValue,
});
const inputs = { origin: TixIR, fn: name, candidate: cuda };
const gate = differential<typeof inputs, Sample, BufferValue>({
  id: 'tensor.cuda.meaning',
  version: '1',
  description: 'GB10 vs original f64 on bounded origin-derived cases',
  inputs,
  baseline: 'origin',
  subject: 'candidate',
  seed: 20,
  count: 15,
  baselineKey: ({ origin, fn }) => JSON.stringify([origin.revision, fn]),
  subjectKey: (_c, _s, { candidate }) => candidate.revision,
  cases: ({ origin, fn }, random) => {
    const f = origin.value.functions.find(f => f.name === fn)!;
    const group = cases(f, f, 'tolerance', random);
    // Do not accept based solely on an empty observation of a variable-size result.
    return group.some(s => s.reference.data.length) || f.shape.some(a => !a.terms.length && a.constant === 0)
      ? group
      : [];
  },
  describeCase: ({ fn, shapeValues, stream }) => ({ fn, shapeValues, stream, seed: 20 }),
  run() {
    throw Error('CUDA observations require asynchronous batch execution');
  },
  compare: (a, b) => compare(a, b, 'tolerance'),
  async decide({ origin, fn, candidate }, samples, todo) {
    const f = origin.value.functions.find(f => f.name === fn)!;
    const results = await runBatch(
      candidate.value,
      f,
      todo.map(i => samples[i].inputs),
    );
    return todo.map((i, j) => {
      const result = compare(samples[i].reference, results[j], 'tolerance');
      return result.ok ? { v: 'agree' } : { v: 'disagree', reason: result.reason! };
    });
  },
});
const pass = defineTransformation({
  id: 'tensor.lower-to-cuda',
  version: '1',
  description: 'Emit CUDA for the executable Tix revision',
  inputs: { origin: TixIR, current: TixIR, fn: name },
  outputs: { candidate: cuda },
  cache: 'never',
  ensures: [
    {
      invariant: gate,
      bindings: {
        origin: { from: 'inputs', port: 'origin' },
        fn: { from: 'inputs', port: 'fn' },
        candidate: { from: 'outputs', port: 'candidate' },
      },
    },
  ],
  run: (_ctx, { origin, current, fn }) => ({
    outputs: { candidate: createArtifact(cuda, 'cuda', cudaSource({ origin, current }, fn)) },
  }),
});
// An already-prepared candidate travels through the same postcondition (also used for mutation tests).
export async function checkCandidate(
  p: TixProgram,
  fn: string,
  source?: string,
): Promise<{ accepted: boolean; relation: 'tolerance'; reason?: string }> {
  const manager = new AnalysisManager();
  const ports = { origin: p.origin, current: p.current, fn };
  try {
    if (source === undefined) await manager.execute(pass, ports);
    else await manager.verifyTransformation(ports, { candidate: createArtifact(cuda, 'cuda', source) }, pass);
    return { accepted: true, relation: 'tolerance' };
  } catch (e) {
    const check = manager
      .snapshot()
      .executions.at(-1)
      ?.checks.find(c => !c.ok);
    const cx = (check?.evidence as DifferentialEvidence | undefined)?.counterexamples?.[0];
    return {
      accepted: false,
      relation: 'tolerance',
      reason: cx ? `${JSON.stringify(cx.case)}: ${cx.reason}` : String(e),
    };
  }
}
export const checkLowering = (program: TixProgram, fn: string) => checkCandidate(program, fn);
