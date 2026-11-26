import { createHash } from 'node:crypto';
import {
  AnalysisManager,
  defineTransformation,
  defineType,
  differential,
  type DifferentialEvidence,
} from '../framework/contracts/index.js';
import { cases, compare, type Sample } from './contract.js';
import { cudaSource, functionNamed } from './cuda-source.js';
import { runBatch } from './cuda-run.js';
import type { BufferValue } from './evaluate.js';
import type { TixProgram } from './index.js';
import { TixIR } from './ir.js';

const text = defineType<string>({
  id: 'tensor.cuda.text',
  version: '1',
  description: 'Function name or CUDA translation unit',
  validate(value) {
    if (typeof value !== 'string') throw Error('Expected text');
  },
});
const ports = { origin: TixIR, fn: text, source: text };
const seed = 20;
const meaning = differential<typeof ports, Sample, BufferValue>({
  id: 'tensor.cuda.meaning',
  version: '1',
  description: 'Returned tensor agrees with the origin f64 evaluator',
  inputs: ports,
  baseline: 'origin',
  subject: 'source',
  seed,
  count: 15,
  cases: ({ origin, fn }, random) => {
    const baseline = functionNamed(origin.value, fn);
    return cases(baseline, baseline, 'tolerance', random);
  },
  baselineKey: ({ origin, fn }) => JSON.stringify([origin.revision, fn, process.version]),
  // Version 1 assumes the same GB10 installation, compiler flags, driver and wire format throughout this process.
  subjectKey: (_subject, _sample, { source }) => createHash('sha256').update(source).digest('hex'),
  run() {
    throw Error('CUDA evidence requires asynchronous batch execution');
  },
  compare: (a, b) => compare(a, b, 'tolerance'),
  describeCase: ({ fn, shapeValues, stream }) => ({ fn, shapeValues, stream, seed }),
  async decide({ origin, fn, source }, samples, todo) {
    const batch = todo.map(id => ({ id, inputs: samples[id].inputs }));
    const results = await runBatch(source, functionNamed(origin.value, fn), batch, 0, 'manuel@bling');
    return results.map((r, k) => {
      const result = compare(samples[todo[k]].reference, r, 'tolerance');
      return result.ok ? { v: 'agree' } : { v: 'disagree', reason: result.reason! };
    });
  },
});
const lowering = defineTransformation({
  id: 'tensor.cuda.lower',
  version: '1',
  description: 'Lower one Tix function to CUDA C',
  inputs: { origin: TixIR, current: TixIR, fn: text },
  outputs: { source: text },
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
});

interface Verdict {
  accepted: boolean;
  relation: 'exact' | 'tolerance';
  reason?: string;
}
export async function checkCandidate(program: TixProgram, fn: string, source: string): Promise<Verdict> {
  const manager = new AnalysisManager();
  try {
    await manager.verifyTransformation(
      { origin: program.origin, current: program.current, fn },
      { source },
      lowering,
    );
    return { accepted: true, relation: 'tolerance' };
  } catch (e) {
    const check = manager.snapshot().executions[0]?.checks.find(c => !c.ok);
    const evidence = check?.evidence as DifferentialEvidence | undefined;
    const example = evidence?.counterexamples[0];
    const reason = example ? JSON.stringify(example.case) + ': ' + example.reason : fn + ': ' + String(e);
    return { accepted: false, relation: 'tolerance', reason };
  }
}
export function checkLowering(program: TixProgram, fn: string): Promise<Verdict> {
  return checkCandidate(program, fn, cudaSource(program, fn));
}
