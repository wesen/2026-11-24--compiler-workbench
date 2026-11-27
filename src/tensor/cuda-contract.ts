import {
  AnalysisManager,
  ContractError,
  createArtifact,
  defineIR,
  defineTransformation,
  defineType,
  differential,
  type Decided,
  type DifferentialEvidence,
} from '../framework/contracts/index.js';
import type { Artifact } from '../framework/core/types.js';
import { makeCorrespondence } from '../framework/ir/index.js';
import { semanticCorrespondence } from '../framework/passes/index.js';
import { coordinate, cudaCases, seed } from './contract.js';
import { runCudaBatch } from './cuda-runtime.js';
import { emitPlan } from './cuda-source.js';
import type { BufferValue } from './evaluate.js';
import { adapter, TixIR } from './ir.js';
import { KernelIR, planKernels, unfusedPlan, type KernelPlan } from './kernels.js';
import { selectFunction, visit, type Module } from './model.js';

interface CudaUnit {
  fn: string;
  source: string;
}

const CudaIR = defineIR<CudaUnit>({
  id: 'tensor.cuda-source',
  version: '1',
  description: 'Standalone CUDA translation unit for a Tix function',
  validate(value) {
    const unit = value as Partial<CudaUnit> | null;
    if (typeof unit?.fn !== 'string' || !unit.fn || typeof unit.source !== 'string' || !unit.source)
      throw Error('Invalid CUDA translation unit');
  },
});
const FunctionName = defineType<string>({
  id: 'tensor.function-name',
  version: '1',
  description: 'Name of the Tix function to lower',
  validate(name) {
    if (typeof name !== 'string' || !name) throw Error('Invalid Tix function name');
  },
});

const Fuse = defineType<boolean>({
  id: 'tensor.fuse',
  version: '1',
  description: 'Whether statements are fused into fewer kernels',
  validate(value) {
    if (typeof value !== 'boolean') throw Error('Invalid fuse flag');
  },
});

/**
 * Which Tix entities became which kernel (IRWB-029-E). A kernel's sources are its statements and the statements
 * inlined into them; parameters and the functions that are not lowered have no target.
 */
export function kernelCorrespondence(baseline: Artifact<Module>, plan: Artifact<KernelPlan>) {
  const { fn, inlined, kernels } = plan.value,
    id = (name: string) => fn.name + '/' + name;
  const statements = new Map(fn.statements.map(s => [s.name, s]));
  const sources = [...adapter.entities(baseline.value)].map(e => e.id);
  const entries = kernels.map((k, i) => {
    const from = new Set(k.mapping === 'row' ? k.statements : [k.statement]);
    for (const name of from)
      visit(statements.get(name)!.expr, e => {
        if (e.kind === 'load' && inlined.includes(e.name)) from.add(e.name);
      });
    return {
      from: Array.from(from, id),
      to: [id('k' + i)],
      relation: from.size > 1 ? 'fused' : 'lowered',
      note: k.mapping === 'row' ? `one block per row, ${k.outer} leading axes` : 'one thread per element',
    };
  });
  const lowered = new Set([fn.name, ...entries.flatMap(e => e.from)]);
  const rest = sources.filter(s => !lowered.has(s));
  return semanticCorrespondence(
    makeCorrespondence(
      { artifact: baseline.id, revision: baseline.revision },
      { artifact: plan.id, revision: plan.revision },
      sources,
      [fn.name, ...entries.flatMap(e => e.to)],
      [
        { from: [fn.name], to: [fn.name], relation: 'function' },
        ...entries,
        ...(rest.length ? [{ from: rest, to: [], relation: 'no-kernel' }] : []),
      ],
    ),
    'statements-to-kernels',
    'kernel-plan',
  );
}

export function cudaArtifact(fn: string, source: string): Artifact<CudaUnit> {
  return createArtifact(CudaIR, 'tix-cuda/' + fn, { fn, source });
}

// The relation is exact: the lowered function must give the current revision's f32 meaning bit for bit, signed
// zeros and infinities included (IRWB-019 F17). The emitter makes that possible: explicit round-to-nearest
// arithmetic, so nothing contracts, and exp, log and tanh in double, rounded, which equal Math.fround(Math.exp(x))
// and so on for all 2^32 f32 inputs on the GB10 (IRWB-019 diary step 23). NaN is compared as a class, because the
// GPU and V8 produce different NaN words (sqrt of -2^-149: 0x7fffffff against 0xffc00000).
function compare(expected: BufferValue, got: BufferValue) {
  if (expected.shape.length !== got.shape.length || expected.shape.some((n, i) => n !== got.shape[i]))
    return { ok: false, reason: 'Output shape differs' };
  if (expected.data.length !== got.data.length) return { ok: false, reason: 'Output length differs' };
  const f32 = (d: ArrayLike<number>) => (d instanceof Float32Array ? d : Float32Array.from(d));
  const a = f32(expected.data),
    b = f32(got.data);
  const wa = new Uint32Array(a.buffer, a.byteOffset, a.length),
    wb = new Uint32Array(b.buffer, b.byteOffset, b.length);
  const hex = (w: number) => '0x' + w.toString(16).padStart(8, '0');
  for (let i = 0; i < a.length; i++) {
    if (wa[i] === wb[i] || (Number.isNaN(a[i]) && Number.isNaN(b[i]))) continue;
    const at = coordinate(expected.shape, i);
    return { ok: false, reason: `At [${at}], expected ${a[i]} (${hex(wa[i])}), got ${b[i]} (${hex(wb[i])})` };
  }
  return { ok: true };
}

function planArtifact(baseline: Artifact<Module>, fn: string, fuse: boolean) {
  const f = selectFunction(baseline.value, fn);
  return createArtifact(KernelIR, 'tix-kernels/' + fn, fuse ? planKernels(f).plan : unfusedPlan(f));
}

type CudaSample = ReturnType<typeof cudaCases>[number];

export function createCudaLowering(profile: string, executeBatch: typeof runCudaBatch = runCudaBatch) {
  const inputs = { baseline: TixIR, fn: FunctionName, fuse: Fuse };
  const outputs = { plan: KernelIR, subject: CudaIR };
  const ports = { baseline: TixIR, fn: FunctionName, subject: CudaIR };
  const invariant = differential<typeof ports, CudaSample, BufferValue>({
    id: 'tensor.cuda-meaning',
    version: '2',
    description:
      'Compare the lowered CUDA function to its current Tix f32 meaning, bit for bit (NaN as a class)',
    inputs: ports,
    baseline: 'baseline',
    subject: 'subject',
    // The recipe is shape-dependent and supplies its whole eligible case set.
    count: 1,
    seed,
    cases: ({ baseline, fn }, random) => {
      const samples = cudaCases(selectFunction(baseline.value, fn), random);
      if (!samples.length) throw Error('No eligible CUDA check cases for ' + fn);
      return samples;
    },
    run: (side, _artifact, sample) => {
      if (side === 'baseline') return sample.reference;
      throw Error('CUDA checks require the batch executor');
    },
    compare,
    describeCase: ({ fn, shapeValues, stream }) => ({ fn, shapeValues, stream, seed }),
    baselineKey: ({ baseline, fn }) => JSON.stringify([baseline.revision, fn]),
    subjectKey: (_artifact, _case, { subject }) => JSON.stringify([subject.revision, profile]),
    async decide({ baseline, fn, subject }, cases, todo) {
      if (subject.value.fn !== fn)
        return todo.map(() => ({ v: 'disagree', reason: 'CUDA function differs' }));
      const pending = todo.map(i => cases[i]);
      const run = (spill: boolean) =>
        executeBatch(
          subject.value.source,
          selectFunction(baseline.value, fn),
          pending.map(c => c.inputs),
          spill ? { spill } : undefined,
        );
      // A source with row kernels has a second path for rows too long for shared memory. No small case reaches
      // it, so the batch runs again with that path forced, and a case agrees only if both runs do.
      const runs = await Promise.all(
        /\bspill_all\b/.test(subject.value.source) ? [run(false), run(true)] : [run(false)],
      );
      if (runs.some(results => results.length !== pending.length))
        throw Error('Wrong CUDA response case count');
      return pending.map((sample, i): Decided => {
        for (const [spilled, results] of runs.entries()) {
          const result = compare(sample.reference, results[i]);
          if (!result.ok)
            return { v: 'disagree', reason: (spilled ? 'With spilled rows: ' : '') + result.reason! };
        }
        return { v: 'agree' };
      });
    },
  });
  const pass = defineTransformation({
    id: 'tensor.lower-cuda',
    version: '1',
    description: 'Lower a Tix function to CUDA and check the candidate on the GPU',
    inputs,
    outputs,
    cache: 'never',
    correspondence: [{ id: 'statements-to-kernels', from: 'baseline', to: 'plan', relation: 'kernel-plan' }],
    ensures: [
      {
        invariant,
        bindings: {
          baseline: { from: 'inputs', port: 'baseline' },
          fn: { from: 'inputs', port: 'fn' },
          subject: { from: 'outputs', port: 'subject' },
        },
      },
    ],
    run(_ctx, { baseline, fn, fuse }) {
      const plan = planArtifact(baseline, fn, fuse);
      return {
        outputs: { plan, subject: cudaArtifact(fn, emitPlan(plan.value)) },
        correspondence: [kernelCorrespondence(baseline, plan)],
      };
    },
  });

  return async (
    baseline: Artifact<Module>,
    fn: string,
    candidate?: Artifact<CudaUnit>,
    options?: { fuse?: boolean },
  ) => {
    const relation = 'exact' as const;
    const manager = new AnalysisManager();
    const fuse = options?.fuse !== false;
    try {
      if (candidate) {
        const plan = planArtifact(baseline, fn, fuse);
        await manager.verifyTransformation({ baseline, fn, fuse }, { plan, subject: candidate }, pass, [
          kernelCorrespondence(baseline, plan),
        ]);
      } else await manager.execute(pass, { baseline, fn, fuse });
      return { accepted: true, relation };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ContractError && error.code === 'postcondition') {
        const checks = manager.snapshot().executions.at(-1)?.checks;
        const evidence = checks?.find(check => check.phase === 'ensures')?.evidence as
          | DifferentialEvidence
          | undefined;
        const first = evidence?.counterexamples[0];
        const reason = first ? `${JSON.stringify(first.case)}: ${first.reason}` : message;
        return { accepted: false, relation, reason };
      }
      return { accepted: false, relation, reason: 'CUDA evidence unavailable: ' + message };
    }
  };
}

export const checkCudaLowering = createCudaLowering('cuda-remote:sm_121:-O3');
