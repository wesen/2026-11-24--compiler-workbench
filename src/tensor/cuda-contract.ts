import {
  AnalysisManager,
  ContractError,
  createArtifact,
  defineIR,
  defineTransformation,
  defineType,
  differential,
  type Correspondence,
  type Decided,
  type DifferentialEvidence,
} from '../framework/contracts/index.js';
import type { Artifact } from '../framework/core/types.js';
import { applyPass } from '../framework/passes/index.js';
import { semanticCorrespondence } from '../framework/passes/index.js';
import { composeCorrespondence, createIRArtifact, type EntityCorrespondence } from '../framework/ir/index.js';
import { coordinate, cudaCases, seed } from './contract.js';
import { runCudaBatch } from './cuda-runtime.js';
import { emitCuda, takesGate } from './cuda-source.js';
import { planFusion, unfusedPlan } from './fusion.js';
import type { BufferValue } from './evaluate.js';
import { TixIR } from './ir.js';
import { selectFunction, type Module } from './model.js';
import { schedulePasses, scheduleFor, tileConfigDefault, type TileConfig } from './schedule-passes.js';
import { SchedIR, scheduleAdapter, toSchedule, type ScheduleUnit } from './schedule.js';

interface CudaKernel {
  name: string;
  mapping: 'thread' | 'block' | 'tile';
  statements: string[];
  /** The host decides at launch between this kernel's block mode and its statements one by one (IRWB-030-E). */
  gated?: boolean;
}
interface CudaUnit {
  fn: string;
  source: string;
  /** The fusion plan the source follows: which statements each kernel computes (IRWB-029-D). */
  kernels: CudaKernel[];
}

export const CudaIR = defineIR<CudaUnit>({
  id: 'tensor.cuda-source',
  version: '3',
  description: "Standalone CUDA translation unit for a Tix function, with its kernels' statements",
  entities: unit => unit.kernels.map(k => k.name),
  validate(value) {
    const unit = value as Partial<CudaUnit> | null;
    if (typeof unit?.fn !== 'string' || !unit.fn || typeof unit.source !== 'string' || !unit.source)
      throw Error('Invalid CUDA translation unit');
    if (
      !Array.isArray(unit.kernels) ||
      unit.kernels.some(
        k =>
          typeof k?.name !== 'string' ||
          !['thread', 'block', 'tile'].includes(k.mapping) ||
          !['boolean', 'undefined'].includes(typeof k.gated) ||
          !Array.isArray(k.statements) ||
          !k.statements.length ||
          k.statements.some(s => typeof s !== 'string'),
      )
    )
      throw Error('Invalid CUDA kernel list');
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
  description: 'Whether the lowering fuses statements into fewer kernels',
  validate(fuse) {
    if (typeof fuse !== 'boolean') throw Error('Invalid fuse flag');
  },
});

export function cudaArtifact(fn: string, source: string, kernels: CudaKernel[] = []): Artifact<CudaUnit> {
  return createArtifact(CudaIR, 'tix-cuda/' + fn, { fn, source, kernels });
}

/** The lowering as a framework correspondence: each kernel and the Tix statement entities it computes. */
export function kernelCorrespondence(
  baseline: Artifact<Module>,
  subject: Artifact<CudaUnit>,
): Correspondence {
  const { fn, kernels } = subject.value;
  return {
    id: 'kernels',
    from: { artifact: baseline.id, revision: baseline.revision },
    to: { artifact: subject.id, revision: subject.revision },
    relation: 'statements-to-kernels',
    sourceEntities: baseline.value.functions.flatMap(f => f.statements.map(s => f.name + '/' + s.name)),
    targetEntities: kernels.map(k => k.name),
    entities: kernels.map(k => ({ from: k.statements.map(s => fn + '/' + s), to: [k.name] })),
    evidence: { mappings: kernels.map(k => k.mapping), gated: kernels.map(k => k.gated === true) },
  };
}

// The schedule pipeline (IRWB-033-I): Tix → schedule IR → CUDA source, each step a checked artifact step.
//
// `tensor.plan-schedule` builds the initial schedule from the fusion plan; the schedule passes refine it
// (each through the framework's pass machinery, with its own diff and correspondence); `tensor.emit-cuda`
// prints the final schedule. The chain's correspondences compose into one statement → kernel record, which
// the `tensor.lower-cuda` acceptance verifies together with the exact meaning invariant on the GPU.
function scheduleEntityList(unit: ScheduleUnit): string[] {
  return unit.kernels.flatMap(k => k.statements.map(s => unit.fn.name + '/' + s));
}
function memberCorrespondence(baseline: Artifact<Module>, schedule: Artifact<ScheduleUnit>): Correspondence {
  const unit = schedule.value;
  return {
    id: 'members',
    from: { artifact: baseline.id, revision: baseline.revision },
    to: { artifact: schedule.id, revision: schedule.revision },
    relation: 'statements-to-members',
    sourceEntities: baseline.value.functions.flatMap(f => f.statements.map(s => f.name + '/' + s.name)),
    targetEntities: scheduleEntityList(unit),
    entities: unit.fn.statements.map(s => ({
      from: [unit.fn.name + '/' + s.name],
      to: [unit.fn.name + '/' + s.name],
    })),
    evidence: { kernels: unit.kernels.map(k => ({ id: k.id, mode: k.mode, statements: k.statements })) },
  };
}
function asEntityCorrespondence(c: Correspondence): EntityCorrespondence {
  return {
    formatVersion: 1,
    from: c.from,
    to: c.to,
    sourceEntities: c.sourceEntities ?? [],
    targetEntities: c.targetEntities ?? [],
    entries: (c.entities ?? []).map(e => ({ from: e.from, to: e.to, relation: c.relation })),
  };
}
const PlanSchedule = defineTransformation({
  id: 'tensor.plan-schedule',
  version: '1',
  description: 'Build the initial schedule of a Tix function from its fusion plan',
  inputs: { baseline: TixIR, fn: FunctionName, fuse: Fuse },
  outputs: { schedule: SchedIR },
  cache: 'pure',
  correspondence: [{ id: 'members', from: 'baseline', to: 'schedule', relation: 'statements-to-members' }],
  run(_ctx, { baseline, fn, fuse }) {
    const f = selectFunction(baseline.value, fn);
    const schedule = createIRArtifact(
      scheduleAdapter,
      'tix-sched/' + fn,
      toSchedule(f, fuse ? planFusion(f) : unfusedPlan(f)),
    );
    return { outputs: { schedule }, correspondence: [memberCorrespondence(baseline, schedule)] };
  },
});
const EmitCuda = defineTransformation({
  id: 'tensor.emit-cuda',
  version: '1',
  description: 'Print a schedule as a CUDA translation unit (the emitter makes no decisions)',
  inputs: { schedule: SchedIR },
  outputs: { subject: CudaIR },
  cache: 'pure',
  correspondence: [{ id: 'kernels', from: 'schedule', to: 'subject', relation: 'members-to-kernels' }],
  run(_ctx, { schedule }) {
    const unit = schedule.value;
    const kernels = unit.kernels.map(k => ({
      name: k.id,
      mapping: k.mode,
      statements: k.statements,
      ...(k.gated && { gated: true }),
    }));
    const subject = cudaArtifact(unit.fn.name, emitCuda(unit.fn, unit), kernels);
    return {
      outputs: { subject },
      correspondence: [
        {
          id: 'kernels',
          from: { artifact: schedule.id, revision: schedule.revision },
          to: { artifact: subject.id, revision: subject.revision },
          relation: 'members-to-kernels',
          sourceEntities: scheduleEntityList(unit),
          targetEntities: kernels.map(k => k.name),
          entities: kernels.map(k => ({ from: k.statements.map(s => unit.fn.name + '/' + s), to: [k.name] })),
          evidence: { mappings: kernels.map(k => k.mapping), gated: kernels.map(k => k.gated === true) },
        },
      ],
    };
  },
});

/** The schedule chain: plan, the passes (when fusing), emit; returns the CUDA artifact and the composed
 *  statement → kernel correspondence over the whole chain. */
export async function lowerThroughSchedule(
  baseline: Artifact<Module>,
  fn: string,
  fuse: boolean,
  manager: AnalysisManager,
  config: TileConfig = tileConfigDefault,
): Promise<{ subject: Artifact<CudaUnit>; correspondence: Correspondence }> {
  const opened = await manager.execute(PlanSchedule, { baseline, fn, fuse });
  let schedule = opened.outputs.schedule as Artifact<ScheduleUnit>;
  const chain: EntityCorrespondence[] = [asEntityCorrespondence(opened.execution.correspondence[0])];
  if (fuse)
    for (const pass of schedulePasses) {
      const result = await applyPass(pass, schedule, { manager, params: config });
      if (result.changed) {
        schedule = result.artifact;
        chain.push(result.correspondence!);
      }
    }
  const emitted = await manager.execute(EmitCuda, { schedule });
  chain.push(asEntityCorrespondence(emitted.execution.correspondence[0]));
  const composed = chain.reduce((a, b) => composeCorrespondence(a, b));
  const final = schedule.value;
  return {
    subject: emitted.outputs.subject as Artifact<CudaUnit>,
    correspondence: {
      ...semanticCorrespondence(composed, 'kernels', 'statements-to-kernels'),
      evidence: {
        steps: chain.map(c => c.from.revision + '->' + c.to.revision),
        mappings: final.kernels.map(k => k.mode),
        gated: final.kernels.map(k => k.gated),
        refusals: final.refusals,
      },
    },
  };
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

// A fused kernel in block mode has a gate: at launch the host runs it fused, or its statements one by one, by the
// shapes (fusion.ts). The recipe's shapes are small, so the rule alone would show little of one side. For a
// program with a gate, every sample is therefore a case on each side, and the program is run once with each side
// forced. A program without a gate has one case per sample.
type Gate = 'fused' | 'unfused';
const sides: readonly Gate[] = ['fused', 'unfused'];
type CudaSample = ReturnType<typeof cudaCases>[number] & { gate?: Gate };

export function createCudaLowering(profile: string, executeBatch: typeof runCudaBatch = runCudaBatch) {
  const inputs = { baseline: TixIR, fn: FunctionName, fuse: Fuse };
  const outputs = { subject: CudaIR };
  const ports = { baseline: TixIR, fn: FunctionName, ...outputs };
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
    cases: ({ baseline, fn, subject }, random): CudaSample[] => {
      const samples = cudaCases(selectFunction(baseline.value, fn), random);
      if (!samples.length) throw Error('No eligible CUDA check cases for ' + fn);
      return takesGate(subject.value.source)
        ? samples.flatMap(s => sides.map(gate => ({ ...s, gate })))
        : samples;
    },
    run: (side, _artifact, sample) => {
      if (side === 'baseline') return sample.reference;
      throw Error('CUDA checks require the batch executor');
    },
    compare,
    describeCase: ({ fn, shapeValues, stream, gate }) => ({
      fn,
      shapeValues,
      stream,
      seed,
      ...(gate && { gate }),
    }),
    // The case list depends on the subject only through whether it has a gate.
    baselineKey: ({ baseline, fn, subject }) =>
      JSON.stringify([baseline.revision, fn, takesGate(subject.value.source)]),
    subjectKey: (_artifact, _case, { subject }) => JSON.stringify([subject.revision, profile]),
    async decide({ baseline, fn, subject }, cases, todo) {
      if (subject.value.fn !== fn)
        return todo.map(() => ({ v: 'disagree', reason: 'CUDA function differs' }));
      const pending = todo.map(i => cases[i]);
      const f = selectFunction(baseline.value, fn);
      const { source } = subject.value;
      const results = new Map<CudaSample, BufferValue>();
      const run = async (batch: CudaSample[], gate?: Gate) => {
        if (!batch.length) return;
        const out = await executeBatch(
          source,
          f,
          batch.map(c => c.inputs),
          { gate },
        );
        if (out.length !== batch.length) throw Error('Wrong CUDA response case count');
        batch.forEach((c, i) => results.set(c, out[i]));
      };
      if (takesGate(source))
        await Promise.all(
          sides.map(g =>
            run(
              pending.filter(c => c.gate === g),
              g,
            ),
          ),
        );
      else await run(pending);
      return pending.map((sample): Decided => {
        const result = compare(sample.reference, results.get(sample)!);
        return result.ok ? { v: 'agree' } : { v: 'disagree', reason: result.reason! };
      });
    },
  });
  const pass = defineTransformation({
    id: 'tensor.lower-cuda',
    version: '2',
    description: 'Lower a Tix function to CUDA, fused or one kernel per statement, and check it on the GPU',
    inputs,
    outputs,
    cache: 'never',
    correspondence: [{ id: 'kernels', from: 'baseline', to: 'subject', relation: 'statements-to-kernels' }],
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
      const f = selectFunction(baseline.value, fn);
      const unit = scheduleFor(f, fuse);
      const kernels = unit.kernels.map(k => ({
        name: k.id,
        mapping: k.mode,
        statements: k.statements,
        ...(k.gated && { gated: true }),
      }));
      const subject = cudaArtifact(fn, emitCuda(f, unit), kernels);
      return { outputs: { subject }, correspondence: [kernelCorrespondence(baseline, subject)] };
    },
  });

  return async (
    baseline: Artifact<Module>,
    fn: string,
    candidate?: Artifact<CudaUnit>,
    options?: { fuse?: boolean; manager?: AnalysisManager },
  ) => {
    const relation = 'exact' as const;
    const manager = options?.manager ?? new AnalysisManager();
    const fuse = options?.fuse !== false;
    try {
      if (candidate)
        await manager.verifyTransformation({ baseline, fn, fuse }, { subject: candidate }, pass, [
          kernelCorrespondence(baseline, candidate),
        ]);
      else {
        // The schedule chain: plan, tile/bind/unroll passes, emit; the composed correspondence and the exact
        // meaning invariant judge the final artifact (IRWB-033-I).
        const { subject, correspondence } = await lowerThroughSchedule(baseline, fn, fuse, manager);
        await manager.verifyTransformation({ baseline, fn, fuse }, { subject }, pass, [correspondence]);
      }
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
