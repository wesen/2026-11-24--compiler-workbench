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
import { emitSchedule, takesGate, variantCount } from './cuda-source.js';
import { lowerSchedule } from './strategy.js';
import type { BufferValue } from './evaluate.js';
import { TixIR } from './ir.js';
import { selectFunction, type Module } from './model.js';

interface CudaKernel {
  name: string;
  mapping: 'thread' | 'block' | 'tiled';
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
          !['thread', 'block', 'tiled'].includes(k.mapping) ||
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
function modesOf(source: string): Mode[] {
  const gate = takesGate(source),
    variants = variantCount(source);
  if (variants)
    return Array.from({ length: variants }, (_, variant) => ({
      variant,
      ...(gate && { gate: variant % 2 ? ('unfused' as const) : ('fused' as const) }),
    }));
  return gate ? [{ gate: 'fused' }, { gate: 'unfused' }] : [{}];
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
      return samples.flatMap(s => modesOf(subject.value.source).map(mode => ({ ...s, ...mode })));
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
      JSON.stringify([baseline.revision, fn, modesOf(subject.value.source)]),
    subjectKey: (_artifact, _case, { subject }) => JSON.stringify([subject.revision, profile]),
    async decide({ baseline, fn, subject }, cases, todo) {
      if (subject.value.fn !== fn)
        return todo.map(() => ({ v: 'disagree', reason: 'CUDA function differs' }));
      const pending = todo.map(i => cases[i]);
      const f = selectFunction(baseline.value, fn);
      const { source } = subject.value;
      const results = new Map<CudaSample, BufferValue>();
      const run = async (batch: CudaSample[], mode: Mode) => {
        if (!batch.length) return;
        const out = await executeBatch(
          source,
          f,
          batch.map(c => c.inputs),
          mode,
        );
        if (out.length !== batch.length) throw Error('Wrong CUDA response case count');
        batch.forEach((c, i) => results.set(c, out[i]));
      };
      await Promise.all(
        modesOf(source).map(mode =>
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
  const pass = defineTransformation({
    id: 'tensor.lower-cuda',
    version: '2',
    description: 'Lower a Tix function to CUDA, fused or one kernel per statement, and check it on the GPU',
    inputs,
    outputs,
    cache: 'never',
    // IRWB-044-C: `partial`. A lowering maps two different entity kinds, so the mapping is not a diff of one IR
    // and the content audit does not apply. A candidate CUDA unit may carry no kernel inventory (the source is
    // what is verified); requiring the inventory to name every statement would reject that candidate before the
    // numbers do. The kernel inventory itself is pinned against `CudaIR.entities` by the entity-list check.
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
    run(_ctx, { baseline, fn, fuse }) {
      // IRWB-033-D: through the schedule IR; its kernels are the CUDA kernels.
      const schedule = lowerSchedule(selectFunction(baseline.value, fn), fuse).value;
      const kernels = schedule.kernels.map(k => ({
        name: k.name,
        mapping: k.kind === 'contraction' ? ('tiled' as const) : k.group.mapping,
        statements: k.group.statements,
        ...(k.kind === 'rows' && k.group.gated && { gated: true }),
      }));
      const subject = cudaArtifact(fn, emitSchedule(schedule), kernels);
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
      else await manager.execute(pass, { baseline, fn, fuse });
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
