import { createHash } from 'node:crypto';
import {
  AnalysisManager,
  defineTransformation,
  defineType,
  differential,
  type Decided,
  type DifferentialEvidence,
} from '../framework/contracts/index.js';
import { cases, compare, type Sample } from './contract.js';
import { named, emitCuda } from './cuda-source.js';
import { runBatch } from './cuda-run.js';
import type { TixProgram } from './index.js';
import { TixIR } from './ir.js';

const text = (id: string) =>
  defineType<string>({
    id: 'tensor.cuda.' + id,
    version: '1',
    description: id,
    validate(x) {
      if (typeof x !== 'string' || !x.length) throw Error('Expected ' + id);
    },
  });
const Name = text('function'),
  Unit = text('unit');
const Target = defineType<{ host: string; nvcc: string }>({
  id: 'tensor.cuda.target',
  version: '1',
  description: 'Configured remote sm_121 target',
  validate(x) {
    if (
      !x ||
      typeof x !== 'object' ||
      !('host' in x) ||
      typeof x.host !== 'string' ||
      !('nvcc' in x) ||
      typeof x.nvcc !== 'string'
    )
      throw Error('Expected target profile');
  },
});
export const loweringInputs = ({ current, origin }: TixProgram, fn: string) => ({
  current,
  origin,
  fn,
  target: {
    host: process.env.CUDA_REMOTE_HOST ?? 'manuel@bling',
    nvcc: process.env.CUDA_REMOTE_NVCC ?? '/usr/local/cuda-13.0/bin/nvcc',
  },
});
const ports = { origin: TixIR, fn: Name, target: Target, unit: Unit };
const digest = (...parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const maxCases = 15,
  seed = 20;
const ensures = differential<typeof ports, Sample>({
  id: 'tensor.cuda.f64-budget',
  version: '1',
  description: 'Origin f64 vs the actual compiled unit on GB10',
  inputs: ports,
  baseline: 'origin',
  subject: 'unit',
  seed,
  count: maxCases,
  baselineKey: ({ origin, fn }) => digest(origin.revision, fn),
  subjectKey: (_, s, { unit, target }) => digest(unit, target.host, target.nvcc, 'sm_121 -O3; abi1'),
  cases: ({ origin, fn }, random) => {
    const f = named(origin.value, fn),
      samples = cases(f, f, 'tolerance', random);
    if (
      !samples.length ||
      (!samples.some(s => s.reference.data.length) && !f.shape.some(d => !d.constant && !d.terms.length))
    )
      throw Error('No comparable reference case for ' + fn);
    return samples;
  },
  describeCase: ({ fn, shapeValues, stream }) => ({ fn, shapeValues, stream, seed }),
  async decide({ origin, fn, unit, target }, cases, todo) {
    const batch = todo.map(id => ({ id, inputs: cases[id].inputs }));
    const { results } = await runBatch(unit, named(origin.value, fn), batch, target.host, false, target.nvcc);
    return todo.map((i, j): Decided => {
      const c = cases[i],
        verdict = compare(c.reference, results[j], 'tolerance');
      return verdict.ok
        ? { v: 'agree' }
        : {
            v: 'disagree',
            reason: `${fn}#${i} shapes=[${c.shapeValues}] ${c.stream} seed=${seed}: ${verdict.reason}`,
          };
    });
  },
});
export const lowering = defineTransformation({
  id: 'tensor.cuda.lower',
  version: '1',
  description: 'One CUDA kernel per Tix statement',
  cache: 'never',
  inputs: { origin: TixIR, current: TixIR, fn: Name, target: Target },
  outputs: { unit: Unit },
  ensures: [
    {
      invariant: ensures,
      bindings: {
        origin: { from: 'inputs', port: 'origin' },
        fn: { from: 'inputs', port: 'fn' },
        target: { from: 'inputs', port: 'target' },
        unit: { from: 'outputs', port: 'unit' },
      },
    },
  ],
  run: (_, { current, fn }) => ({ outputs: { unit: emitCuda(named(current.value, fn)) } }),
});
export async function checkLowering(
  program: TixProgram,
  fn: string,
): Promise<{ accepted: boolean; relation: 'exact' | 'tolerance'; reason?: string }> {
  const manager = new AnalysisManager();
  try {
    await manager.execute(lowering, loweringInputs(program, fn));
    return { accepted: true, relation: 'tolerance' };
  } catch (e) {
    const check = manager.snapshot().executions.at(-1)?.checks.at(-1);
    const cx = (check?.evidence as DifferentialEvidence | undefined)?.counterexamples?.[0];
    return { accepted: false, relation: 'tolerance', reason: cx?.reason ?? String(e) };
  }
}
