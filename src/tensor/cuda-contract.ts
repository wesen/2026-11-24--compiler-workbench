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
import { coordinate, cudaCases, seed } from './contract.js';
import { runCudaBatch } from './cuda-runtime.js';
import { emitSchedule, takesGate, tileModes } from './cuda-source.js';
import type { Fn } from './model.js';
import { ScheduleIR, type Schedule } from './schedule.js';
import { buildSchedule, fusedPlan, unfusedStrategy } from './schedule-passes.js';
import type { BufferValue } from './evaluate.js';
import { TixIR } from './ir.js';
import { selectFunction, type Module } from './model.js';

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
  version: '2',
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
/**
 * The pipeline Tix -> schedule -> CUDA source for one function (IRWB-033-E): the strategy plan's passes from the
 * initial schedule, then the printer. Unchecked runs (`cudaSource`, `runTixCuda`) validate each step through the
 * schedule IR; `checked` also runs the interpreter's exact check on every step.
 */
const lowered = new WeakMap<Fn, Map<string, ReturnType<typeof lowerNow>>>();
function lowerNow(f: Fn, fuse: boolean, checked: boolean) {
  const built = buildSchedule(f, fuse ? fusedPlan : unfusedStrategy, { check: checked });
  return { ...built, source: emitSchedule(built.schedule.value) };
}
export function lowerToSchedule(f: Fn, fuse: boolean, checked = false) {
  const cache = lowered.get(f) ?? new Map<string, ReturnType<typeof lowerNow>>();
  lowered.set(f, cache);
  const key = `${fuse}/${checked}`;
  // a checked build also serves unchecked requests
  const hit = cache.get(key) ?? (checked ? undefined : cache.get(`${fuse}/true`));
  if (hit) return hit;
  const result = lowerNow(f, fuse, checked);
  cache.set(key, result);
  return result;
}
const kernelsOf = (schedule: Schedule): CudaKernel[] =>
  schedule.kernels.map(k => ({
    name: k.name,
    mapping: k.kind,
    statements: k.statements,
    ...(k.kind === 'block' && k.gate && { gated: true }),
  }));

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
// A tile kernel has configurations chosen at launch by the number of tiles (IRWB-033-E); the recipe's shapes
// would choose stage 2's mapping nearly always. For a program with tile kernels every sample is a case with each
// configuration forced, and one with stage 2's mapping; the gate's sides are spread over those runs.
type Gate = 'fused' | 'unfused';
const gateSides: readonly Gate[] = ['fused', 'unfused'];
interface Side {
  gate?: Gate;
  tile?: number;
}
export function sidesOf(source: string): Side[] {
  const gated = takesGate(source),
    modes = tileModes(source);
  if (!gated && !modes) return [{}];
  const n = Math.max(modes ? modes + 1 : 1, gated ? 2 : 1);
  return Array.from({ length: n }, (_, i) => ({
    ...(gated && { gate: gateSides[i % 2] }),
    ...(modes && { tile: i % (modes + 1) }),
  }));
}
type CudaSample = ReturnType<typeof cudaCases>[number] & Side;

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
      return samples.flatMap(s => sidesOf(subject.value.source).map(side => ({ ...s, ...side })));
    },
    run: (side, _artifact, sample) => {
      if (side === 'baseline') return sample.reference;
      throw Error('CUDA checks require the batch executor');
    },
    compare,
    describeCase: ({ fn, shapeValues, stream, gate, tile }) => ({
      fn,
      shapeValues,
      stream,
      seed,
      ...(gate && { gate }),
      ...(tile !== undefined && { tile }),
    }),
    // The case list depends on the subject only through its sides: whether it has a gate, and its tile modes.
    baselineKey: ({ baseline, fn, subject }) =>
      JSON.stringify([baseline.revision, fn, sidesOf(subject.value.source)]),
    subjectKey: (_artifact, _case, { subject }) => JSON.stringify([subject.revision, profile]),
    async decide({ baseline, fn, subject }, cases, todo) {
      if (subject.value.fn !== fn)
        return todo.map(() => ({ v: 'disagree', reason: 'CUDA function differs' }));
      const pending = todo.map(i => cases[i]);
      const f = selectFunction(baseline.value, fn);
      const { source } = subject.value;
      const results = new Map<CudaSample, BufferValue>();
      const run = async (batch: CudaSample[], side: Side) => {
        if (!batch.length) return;
        const out = await executeBatch(
          source,
          f,
          batch.map(c => c.inputs),
          side,
        );
        if (out.length !== batch.length) throw Error('Wrong CUDA response case count');
        batch.forEach((c, i) => results.set(c, out[i]));
      };
      await Promise.all(
        sidesOf(source).map(side =>
          run(
            pending.filter(c => c.gate === side.gate && c.tile === side.tile),
            side,
          ),
        ),
      );
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
      const { schedule, source } = lowerToSchedule(f, fuse, true);
      const subject = cudaArtifact(fn, source, kernelsOf(schedule.value));
      return { outputs: { subject }, correspondence: [kernelCorrespondence(baseline, subject)] };
    },
  });

  // Tix -> schedule (IRWB-033-E): the strategy's passes, each checked by the schedule interpreter against the f32
  // meaning with the accumulation-order assertions on (schedule-eval.ts). The manager checks the correspondence's
  // entity lists against the Tix statements and the schedule's kernels.
  const schedulePass = defineTransformation({
    id: 'tensor.schedule-tix',
    version: '1',
    description: 'Schedule a Tix function: stage 2, then the checked schedule steps of the strategy plan',
    inputs,
    outputs: { schedule: ScheduleIR },
    cache: 'never',
    correspondence: [
      { id: 'schedule', from: 'baseline', to: 'schedule', relation: 'statements-to-schedule-kernels' },
    ],
    run(_ctx, { baseline, fn, fuse }) {
      const { schedule, steps } = lowerToSchedule(selectFunction(baseline.value, fn), fuse, true);
      return {
        outputs: { schedule },
        correspondence: [
          {
            id: 'schedule',
            from: { artifact: baseline.id, revision: baseline.revision },
            to: { artifact: schedule.id, revision: schedule.revision },
            relation: 'statements-to-schedule-kernels',
            sourceEntities: baseline.value.functions.flatMap(f =>
              f.statements.map(s => f.name + '/' + s.name),
            ),
            targetEntities: schedule.value.kernels.map(k => k.name),
            entities: schedule.value.kernels.map(k => ({
              from: k.statements.map(s => fn + '/' + s),
              to: [k.name],
            })),
            evidence: { steps },
          },
        ],
      };
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
        try {
          await manager.execute(schedulePass, { baseline, fn, fuse });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { accepted: false, relation, reason: 'Schedule rejected: ' + message };
        }
        await manager.execute(pass, { baseline, fn, fuse });
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
