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
import {
  composeCorrespondence,
  createIRArtifact,
  defineAdapter,
  makeCorrespondence,
  openIR,
  type CorrespondenceEntry,
  type EntityCorrespondence,
  type IREntity,
} from '../framework/ir/index.js';
import {
  applyTransformation,
  passAlgorithm,
  PassError,
  transformation,
  type CrossResult,
} from '../framework/passes/index.js';
import {
  AlgorithmRegistry,
  algorithm,
  executeSync,
  StrategyExecutionError,
} from '../framework/strategy/index.js';
import { coordinate, cudaCases, seed } from './contract.js';
import { runCudaBatch } from './cuda-runtime.js';
import { emitScheduleProgram, type CudaKernel } from './cuda-source.js';
import { schedulePlan, scheduleRegistry } from './strategy.js';
import type { BufferValue } from './evaluate.js';
import { TixIR, adapter } from './ir.js';
import { selectFunction, type Module } from './model.js';
import { fusePass, initialSchedule, loopsPass, scheduleAdapter, type Schedule } from './schedule.js';

export interface CudaUnit {
  fn: string;
  source: string;
  /**
   * The program's manifest (cuda-source.ts): which statements each kernel computes (IRWB-029-D), which kernels
   * have a gate (IRWB-030-E) and how many variants a contraction kernel has.
   */
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
          !['thread', 'block', 'tiled'].includes(k.mapping) ||
          !['boolean', 'undefined'].includes(typeof k.gated) ||
          !(k.variants === undefined || (Number.isSafeInteger(k.variants) && k.variants > 0)) ||
          !Array.isArray(k.statements) ||
          !k.statements.length ||
          k.statements.some(s => typeof s !== 'string'),
      )
    )
      throw Error('Invalid CUDA kernel list');
  },
});
const kernelEntities = (unit: CudaUnit): IREntity[] =>
  unit.kernels.map(({ name, ...attributes }) => ({ id: name, kind: 'kernel', attributes }));
/** IRWB-061: the unit as entities, one per kernel of its manifest, so the runner can build and relate it. */
export const cudaAdapter = defineAdapter<CudaUnit>({
  id: 'tensor.cuda.adapter',
  version: '1',
  description: 'The kernels of a CUDA translation unit, from its manifest',
  kind: CudaIR.id,
  schemaVersion: CudaIR.version,
  validate: value => CudaIR.validate(value),
  relationKinds: {},
  entities: kernelEntities,
  relations: () => [],
  resolve: (unit, id) => kernelEntities(unit).find(e => e.id === id),
  describe: (_, id) => ({ label: id }),
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

/** The parameters of one lowering: the function, and whether its statements are fused into fewer kernels. */
export interface CudaLoweringParams {
  readonly fn: string;
  readonly fuse: boolean;
}
const ref = (a: Artifact) => ({ artifact: a.id, revision: a.revision });
const ids = (entities: readonly IREntity[]) => entities.map(e => e.id);
const scheduleIds = (s: Artifact<Schedule>) => ids(openIR(s, scheduleAdapter).graph().entities);
const decisions = ['tensor.schedule.decide-fuse', 'tensor.schedule.decide-loops'].map(id =>
  scheduleRegistry.get(algorithm(id, '1')),
);
/**
 * The scheduled function with the correspondence of every schedule pass that changed it. `schedulePlan`
 * (strategy.ts) runs on a registry whose pass algorithms report their runner results; the decisions are the
 * scheduling registry's own, so the schedule is `lowerSchedule`'s.
 */
function schedule(initial: Artifact<Schedule>, fuse: boolean) {
  const steps: EntityCorrespondence[] = [];
  if (!fuse) return { schedule: initial, steps };
  const registry = new AlgorithmRegistry();
  for (const d of decisions) registry.register(d);
  for (const pass of [fusePass, loopsPass])
    registry.register(
      passAlgorithm(pass, { onResult: r => void (r.changed && steps.push(r.correspondence!)) }),
    );
  const execution = executeSync(schedulePlan, registry, initial);
  if (execution.status !== 'succeeded') throw new StrategyExecutionError(execution);
  return { schedule: execution.value as Artifact<Schedule>, steps };
}
/**
 * IRWB-033-D, IRWB-061: Tix -> schedule IR (one pointwise kernel per statement, then the checked fusion and loop
 * passes) -> CUDA source; the schedule's kernels are the CUDA kernels. The correspondence from Tix entities to
 * CUDA kernels is composed from the four links: statements to the initial kernels, each schedule pass's own
 * (from the runner), and schedule kernels to the emitted kernels of the same name.
 */
function lowerTix(
  baseline: Artifact<Module>,
  entities: readonly IREntity[],
  { fn, fuse }: CudaLoweringParams,
): CrossResult<CudaUnit> {
  const f = selectFunction(baseline.value, fn);
  const initial = initialSchedule(f);
  const { schedule: scheduled, steps } = schedule(initial, fuse);
  const { source, kernels } = emitScheduleProgram(scheduled.value);
  const output = { fn, source, kernels },
    outputId = 'tix-cuda/' + fn;
  const unit = createIRArtifact(cudaAdapter, outputId, output);
  const chain = [
    makeCorrespondence(
      ref(baseline),
      ref(initial),
      ids(entities),
      scheduleIds(initial),
      initial.value.kernels.map(k => ({
        from: k.group.statements.map(s => fn + '/' + s),
        to: [k.name],
        relation: 'scheduled',
      })),
    ),
    ...steps,
    makeCorrespondence(
      ref(scheduled),
      ref(unit),
      scheduleIds(scheduled),
      kernels.map(k => k.name),
      kernels.map(k => ({ from: [k.name], to: [k.name], relation: 'emitted' })),
    ),
  ];
  const composed = chain.reduce((a, b) => composeCorrespondence(a, b));
  // The composed relation, written one entry per kernel (a grouped entry denotes every pair of its two sides, so
  // this is the same relation). The runner completes the rest: statements of other functions and parameters as
  // removed.
  const correspondence = kernels.flatMap(k => {
    const mapped = composed.entries.filter(e => e.from.length && e.to.includes(k.name));
    return mapped.length
      ? [
          {
            from: [...new Set(mapped.flatMap(e => e.from))],
            to: [k.name],
            relation: [...new Set(mapped.map(e => e.relation))].join(' | '),
          },
        ]
      : [];
  });
  return { output, outputId, correspondence, edits: kernels.length };
}
/** What a supplied unit's manifest claims: each kernel and the statements it computes. */
const manifestEntries = ({ fn, kernels }: CudaUnit): CorrespondenceEntry[] =>
  kernels.map(k => ({ from: k.statements.map(s => fn + '/' + s), to: [k.name], relation: 'emitted' }));

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
// shapes (fusion.ts). A contraction kernel (IRWB-033-D) has variants, one of which the host picks at launch. The
// recipe's shapes are small, so the rules alone would show little of most sides. Every sample is therefore a case in
// every mode: each variant forced in turn, paired alternately with the two gate sides when there is a gate; or the
// two gate sides; or, with neither, the sample once. The program is run once per mode from one compilation.
type Gate = 'fused' | 'unfused';
interface Mode {
  gate?: Gate;
  variant?: number;
}
function modesOf(kernels: readonly CudaKernel[]): Mode[] {
  const gates = new Set<NonNullable<Mode['gate']>>();
  const variants = new Set<number>();
  for (const kernel of kernels)
    for (const arm of kernel.select ?? []) {
      if ('gate' in arm) gates.add(arm.gate);
      else variants.add(arm.variant);
    }
  const gateModes = [...gates];
  const variantModes = [...variants].sort((a, b) => a - b);
  return Array.from({ length: Math.max(1, gateModes.length, variantModes.length) }, (_, i) => ({
    ...(gateModes.length && { gate: gateModes[i % gateModes.length] }),
    ...(variantModes.length && { variant: variantModes[i % variantModes.length] }),
  }));
}
type CudaSample = ReturnType<typeof cudaCases>[number] & Mode;

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
      return samples.flatMap(s => modesOf(subject.value.kernels).map(mode => ({ ...s, ...mode })));
    },
    run: (side, _artifact, sample) => {
      if (side === 'baseline') return sample.reference;
      throw Error('CUDA checks require the batch executor');
    },
    compare,
    describeCase: ({ fn, shapeValues, stream, gate, variant }) => ({
      fn,
      shapeValues,
      stream,
      seed,
      ...(gate && { gate }),
      ...(variant !== undefined && { variant }),
    }),
    // The case list depends on the subject only through its modes.
    baselineKey: ({ baseline, fn, subject }) =>
      JSON.stringify([baseline.revision, fn, modesOf(subject.value.kernels)]),
    subjectKey: (_artifact, _case, { subject }) => JSON.stringify([subject.revision, profile]),
    async decide({ baseline, fn, subject }, cases, todo) {
      if (subject.value.fn !== fn)
        return todo.map(() => ({ v: 'disagree', reason: 'CUDA function differs' }));
      const pending = todo.map(i => cases[i]);
      const f = selectFunction(baseline.value, fn);
      const { source, kernels } = subject.value;
      const results = new Map<CudaSample, BufferValue>();
      const run = async (batch: CudaSample[], mode: Mode) => {
        if (!batch.length) return;
        const out = await executeBatch(
          source,
          f,
          batch.map(c => c.inputs),
          { ...mode, kernels },
        );
        if (out.length !== batch.length) throw Error('Wrong CUDA response case count');
        batch.forEach((c, i) => results.set(c, out[i]));
      };
      await Promise.all(
        modesOf(kernels).map(mode =>
          run(
            pending.filter(c => c.gate === mode.gate && c.variant === mode.variant),
            mode,
          ),
        ),
      );
      return pending.map((sample): Decided => {
        const result = compare(sample.reference, results.get(sample)!);
        return result.ok ? { v: 'agree' } : { v: 'disagree', reason: result.reason! };
      });
    },
  });
  // The contract: its ports, the correspondence it requires and the GPU check. The lowering itself is the
  // transformation below; the runner prepares the unit and verifies it against this (IRWB-061).
  const contract = defineTransformation({
    id: 'tensor.lower-cuda',
    version: '3',
    description: 'A CUDA unit computes the current Tix f32 meaning of its function, checked on the GPU',
    inputs,
    outputs,
    cache: 'never',
    correspondence: [
      {
        id: 'kernels',
        from: 'baseline',
        to: 'subject',
        relation: 'statements-to-kernels',
        coverage: 'partial',
      },
    ],
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
  });
  /**
   * `tensor.lower-cuda` as a transformation from `tensor.tix` to `tensor.cuda-source`. Its `ensures` answers from
   * the GPU, so a checked application runs under the asynchronous driver; a pending one (`cudaSource`, index.ts)
   * runs synchronously and leaves the check owed.
   */
  const lowering = transformation<Module, CudaUnit, {}, CudaLoweringParams>({
    id: 'tensor.lower-cuda',
    version: '3',
    description: 'Lower a Tix function to CUDA, fused or one kernel per statement, and check it on the GPU',
    from: { ir: TixIR, adapter },
    to: { ir: CudaIR, adapter: cudaAdapter },
    relation: 'exact',
    prepare: ({ before, view, params }) => lowerTix(before, view.graph().entities, params),
    bind: ({ before, candidate, params }) => ({
      inputs: { baseline: before, fn: params.fn, fuse: params.fuse },
      outputs: { subject: candidate },
    }),
    obligations: { ensures: [contract] },
  });
  /** The same transformation for a unit the caller supplies: the candidate is that unit, as its manifest says. */
  const supplied = (candidate: Artifact<CudaUnit>): typeof lowering => ({
    ...lowering,
    prepare: () => ({
      output: candidate.value,
      outputId: candidate.id,
      correspondence: manifestEntries(candidate.value),
    }),
  });

  const check = async (
    baseline: Artifact<Module>,
    fn: string,
    candidate?: Artifact<CudaUnit>,
    options?: { fuse?: boolean; manager?: AnalysisManager },
  ) => {
    const relation = 'exact' as const;
    const manager = options?.manager ?? new AnalysisManager();
    const fuse = options?.fuse !== false;
    try {
      await applyTransformation(candidate ? supplied(candidate) : lowering, baseline, {
        manager,
        params: { fn, fuse },
      });
      return { accepted: true, relation };
    } catch (thrown) {
      // the runner wraps the manager's rejection; its own error says whether the check answered or was unavailable
      const error = thrown instanceof PassError && thrown.code === 'contractRejected' ? thrown.cause : thrown;
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
  return Object.assign(check, { lowering });
}

export const checkCudaLowering = createCudaLowering('cuda-remote:sm_121:-O3');
/** `tensor.lower-cuda`, the transformation every lowering of a Tix function is an application of. */
export const cudaLowering = checkCudaLowering.lowering;
