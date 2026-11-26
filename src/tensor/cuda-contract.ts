import { createHash } from 'node:crypto';
import {
  AnalysisManager,
  defineTransformation,
  defineType,
  differential,
  type DifferentialEvidence,
  type Decided,
} from '../framework/contracts/index.js';
import { cases, compare, type Sample } from './contract.js';
import { emit, selected } from './cuda-source.js';
import { runBatch } from './cuda-run.js';
import type { BufferValue } from './evaluate.js';
import type { TixProgram } from './index.js';
import { TixIR } from './ir.js';

const Text = defineType<string>({
  id: 'tensor.cuda.text',
  version: '1',
  description: 'CUDA source or function name',
  validate(value): asserts value is string {
    if (typeof value !== 'string') throw Error('Expected text');
  },
});
const ports = { baseline: TixIR, fn: Text, subject: Text };
const describeCase = ({ fn, shapeValues, stream }: Sample) => ({ fn, shapeValues, stream, seed: 20 });

// Version 1 assumes a fixed GB10/driver, CUDA 13.0 and -O3 -arch=sm_121 throughout this process.
const invariant = differential<typeof ports, Sample, BufferValue>({
  id: 'tensor.cuda.meaning',
  version: '1',
  description: 'Batched GPU output against original f64',
  inputs: ports,
  baseline: 'baseline',
  subject: 'subject',
  seed: 20,
  count: 15,
  baselineKey: ({ baseline, fn }) => JSON.stringify([baseline.revision, fn]),
  subjectKey: (_subject, _sample, { subject }) => createHash('sha256').update(subject).digest('hex'),
  cases: ({ baseline, fn }, random) => {
    const f = selected(baseline, fn);
    return cases(f, f, 'tolerance', random);
  },
  run() {
    throw Error('CUDA cases require async batch execution');
  },
  compare: (a, b) => compare(a, b, 'tolerance'),
  describeCase,
  async decide({ baseline, subject, fn }, samples, todo) {
    const results = await runBatch(
      subject,
      selected(baseline, fn),
      todo.map(i => samples[i].inputs),
      { host: 'manuel@bling' },
    );
    return todo.map((i, k): Decided => {
      const c = compare(samples[i].reference, results[k], 'tolerance');
      return c.ok ? { v: 'agree' } : { v: 'disagree', reason: c.reason! };
    });
  },
});

export const lowering = defineTransformation({
  id: 'tensor.cuda.lower',
  version: '1',
  description: 'Emit CUDA and check its result on the GB10',
  inputs: { origin: TixIR, current: TixIR, fn: Text },
  outputs: { source: Text },
  cache: 'never',
  ensures: [
    {
      invariant,
      bindings: {
        baseline: { from: 'inputs', port: 'origin' },
        fn: { from: 'inputs', port: 'fn' },
        subject: { from: 'outputs', port: 'source' },
      },
    },
  ],
  run: (_ctx, { current, fn }) => ({ outputs: { source: emit(selected(current, fn)) } }),
});
export async function checkLowering(
  program: TixProgram,
  fn: string,
): Promise<{
  accepted: boolean;
  relation: 'exact' | 'tolerance';
  reason?: string;
}> {
  const manager = new AnalysisManager();
  try {
    await manager.execute(lowering, { ...program, fn });
    return { accepted: true, relation: 'tolerance' };
  } catch (error) {
    const check = manager
      .snapshot()
      .executions.at(-1)
      ?.checks.find(c => !c.ok);
    const evidence = check?.evidence as DifferentialEvidence | undefined;
    const example = evidence?.counterexamples[0];
    const reason = example ? JSON.stringify(example.case) + ' ' + example.reason : String(error);
    return { accepted: false, relation: 'tolerance', reason };
  }
}
