import { createHash } from 'node:crypto';
import {
  AnalysisManager,
  defineTransformation,
  defineType,
  differential,
  type DifferentialEvidence,
} from '../framework/contracts/index.js';
import { compare, meaningCases, type Sample } from './contract.js';
import { cudaSource, selectFn } from './cuda-source.js';
import { profile, runBatch } from './cuda-run.js';
import type { TixProgram } from './index.js';
import { TixIR } from './ir.js';

const text = defineType<string>({
  id: 'tensor.cuda.text',
  version: '1',
  description: 'Nonempty string',
  validate(x) {
    if (typeof x !== 'string' || !x.length) throw Error('Expected nonempty text');
  },
});
const inputs = { origin: TixIR, current: TixIR, fn: text, target: text };
const outputs = { source: text };
const ports = { ...inputs, ...outputs };
interface Verdict {
  accepted: boolean;
  relation: 'tolerance';
  reason?: string;
}

/** Inject a batch engine only in an independent memo namespace (e.g. for transport failure tests). */
export function loweringChecker(id: string, batch: typeof runBatch) {
  return async (program: TixProgram, fn: string, source: string): Promise<Verdict> => {
    const target = profile();
    const sourceHash = createHash('sha256').update(source).digest('hex');
    const invariant = differential<typeof ports, Sample, never>({
      id: id + '.meaning',
      version: '1',
      description: 'Origin f64 vs compiled CUDA, on identical f32 inputs',
      inputs: ports,
      baseline: 'origin',
      subject: 'source',
      count: 1,
      seed: 20,
      baselineKey: p => JSON.stringify([p.origin.revision, p.fn]),
      subjectKey: (_s, _c, p) => JSON.stringify([sourceHash, p.current.revision, p.target]),
      cases: (p, r) => {
        const f = selectFn(p.origin, p.fn);
        return meaningCases(f, f, 'tolerance', r, true);
      },
      run() {
        throw Error('CUDA meaning requires batch delegation');
      },
      compare() {
        throw Error('Expected batch comparison');
      },
      describeCase: ({ fn, shapeValues, stream }) => ({ fn, shapeValues, stream, seed: 20 }),
      decide: async (p, cases, todo) => {
        const results = await batch(
          selectFn(p.current, p.fn),
          p.source,
          todo.map(i => cases[i].inputs),
          target,
        );
        if (results.length !== todo.length) throw Error('Incomplete CUDA batch');
        return todo.map((index, j) => {
          const s = cases[index],
            got = results[j];
          if (!got || got.data.length !== s.reference.data.length) throw Error('Invalid CUDA record length');
          const check = compare(s.reference, got, 'tolerance');
          return check.ok ? { v: 'agree' } : { v: 'disagree', reason: check.reason! };
        });
      },
    });
    const contract = defineTransformation({
      id,
      version: '1',
      description: 'Checked direct lowering of one Tix function',
      inputs,
      outputs,
      cache: 'never',
      ensures: [
        {
          invariant,
          bindings: {
            origin: { from: 'inputs', port: 'origin' },
            current: { from: 'inputs', port: 'current' },
            fn: { from: 'inputs', port: 'fn' },
            target: { from: 'inputs', port: 'target' },
            source: { from: 'outputs', port: 'source' },
          },
        },
      ],
    });
    const manager = new AnalysisManager();
    try {
      await manager.verifyTransformation(
        { ...program, fn, target: JSON.stringify(target) },
        { source },
        contract,
      );
      return { accepted: true, relation: 'tolerance' };
    } catch (e) {
      const evidence = manager.snapshot().executions.at(-1)?.checks.at(-1)?.evidence as
        | DifferentialEvidence
        | undefined;
      const cx = evidence?.counterexamples?.[0];
      const reason = cx
        ? `${JSON.stringify(cx.case)}: ${cx.reason}`
        : e instanceof Error
          ? e.message
          : String(e);
      return { accepted: false, relation: 'tolerance', reason };
    }
  };
}
export const checkCandidate = loweringChecker('tensor.cuda.lower', runBatch);
export async function checkLowering(program: TixProgram, fn: string): Promise<Verdict> {
  return checkCandidate(program, fn, cudaSource(program, fn));
}
