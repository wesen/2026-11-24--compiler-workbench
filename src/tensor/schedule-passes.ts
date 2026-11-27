// IRWB-033-G: the scheduling passes, and the analysis that checks them.
//
// Each step of the schedule is a v6 pass over `tensor.schedule` (`tensor.schedule-build` is the cross-kind one from
// Tix). A pass decides its legality from the IR before it makes a revision, and each application is gated by
// `tensor.accumulation-order`: the visit order of every outermost reduction of every member, recomputed on the
// output and compared with the input's. A pass that reordered a reduction cannot be applied. That is the whole
// argument for the f32 result of a scheduling step — the GPU check (`checkLowering`) still has to show that the
// printed code follows the schedule.
import { JsonValue, createArtifact, defineAnalysis } from '../framework/contracts/index.js';
import type { Artifact } from '../framework/core/types.js';
import { PassError, applyNativePassSync, definePass, type PassResult } from '../framework/passes/index.js';
import { TixIR, adapter as tixAdapter } from './ir.js';
import { planFusion, unfusedPlan } from './fusion.js';
import { plain, type Fn } from './model.js';
import {
  ScheduleIR,
  contractionOf,
  orderClaim,
  orderViolation,
  scheduleAdapter,
  scheduleFromPlan,
  type ScheduleFunction,
  type ScheduleKernel,
} from './schedule.js';

/** A step that the IR does not allow. Thrown before any revision exists, so it is not a rejected candidate. */
export class ScheduleRefusal extends Error {
  constructor(
    readonly pass: string,
    readonly reason: string,
  ) {
    super(`${pass}: ${reason}`);
    this.name = 'ScheduleRefusal';
  }
}

/**
 * The visit order of every outermost reduction of every member, flattened to the sequence of indices each output
 * element accumulates. `orderClaim` (schedule.ts) reads only the schedule, so the framework can recompute it on a
 * pass's output and compare it with the input's.
 */
export const AccumulationOrder = defineAnalysis({
  id: 'tensor.accumulation-order',
  version: '1',
  description: 'The order in which each output element of each reduction visits its terms, from the schedule',
  input: ScheduleIR,
  output: JsonValue,
  run: (_ctx, artifact) => [...orderClaim(artifact.value)],
});

/** The gate every scheduling pass is applied through: the accumulation order and the statement coverage must hold. */
export function scheduleGate(
  before: Artifact<any>,
  after: Artifact<ScheduleFunction>,
): { ok: boolean; reason?: string } {
  const schedule = after.value;
  if (before.kind === ScheduleIR.id) {
    const violation = orderViolation(before.value as ScheduleFunction, schedule);
    if (violation) return { ok: false, reason: violation };
  }
  const seen = new Map<string, number>();
  for (const kernel of schedule.kernels) for (const m of kernel.members) seen.set(m, (seen.get(m) ?? 0) + 1);
  for (const [name, count] of seen)
    if (count !== 1) return { ok: false, reason: `${name} is a member of ${count} kernels` };
  return { ok: true };
}

const kernelNamed = (schedule: ScheduleFunction, name: string): ScheduleKernel => {
  const kernel = schedule.kernels.find(k => k.name === name);
  if (!kernel) throw new Error(`The schedule has no kernel ${name}`);
  return kernel;
};
// The artifact's value is frozen: a pass works on a copy and returns it as the next native value.
const copy = (schedule: ScheduleFunction): ScheduleFunction => structuredClone(schedule);

/** The Tix function a scheduling pass is applied to: the schedule names its artifact, the bodies come from here. */
export interface ScheduleStepParams {
  fn: Fn;
  kernel?: string;
  block?: [number, number];
  lane?: [number, number];
  kTile?: number;
  stage?: string[];
  buffer?: 'single' | 'double';
  fuse?: boolean;
}

/**
 * Tix → schedule: the fusion plan of stage 3 and 3b, turned into kernels. This is the framework's first cross-kind
 * pass (the input artifact is of `tensor.tix`, the output of `tensor.schedule`), which needed `PassSpec.source`.
 */
export const scheduleBuildPass = definePass<ScheduleFunction, {}, ScheduleStepParams>({
  id: 'tensor.schedule-build',
  version: '1',
  description:
    'Turn a Tix function’s fusion plan into a schedule: its kernels, members and where their values live',
  ir: ScheduleIR,
  adapter: scheduleAdapter,
  source: { ir: TixIR, adapter: tixAdapter },
  writes: { entities: ['*'], relations: ['*'] },
  run({ before, params }) {
    const fn = params.fn;
    const plan = params.fuse === false ? unfusedPlan(fn) : planFusion(fn);
    const schedule = scheduleFromPlan(fn, plan, { artifact: before.id, revision: before.revision });
    return {
      native: schedule,
      edits: schedule.kernels.length,
      report: { kernels: schedule.kernels.length, reasons: schedule.kernels.map(k => k.reasons) },
    };
  },
});

/**
 * Bind the block domain: one block per `block` tile of the two output axes, one lane per `lane` patch of them. The
 * outputs the tile covers are independent of each other, so nothing about an output's own accumulation changes.
 */
export const scheduleTileDomainPass = definePass<ScheduleFunction, {}, ScheduleStepParams>({
  id: 'tensor.schedule-tile-domain',
  version: '1',
  description: 'Tile a contraction’s outputs into blocks and lane patches, and strip-mine its reduction',
  ir: ScheduleIR,
  adapter: scheduleAdapter,
  writes: { entities: ['kernel'], relations: [] },
  run({ before, params }) {
    const legal = contractionOf(kernelNamed(before.value, params.kernel!), params.fn);
    if (!legal.ok) throw new ScheduleRefusal('tensor.schedule-tile-domain', legal.reason);
    const [BI, BJ] = params.block!,
      [TM, TN] = params.lane!;
    const lanes = (BI / TM) * (BJ / TN);
    const refuse = (reason: string) => {
      throw new ScheduleRefusal('tensor.schedule-tile-domain', `${params.kernel}: ${reason}`);
    };
    if (![BI, BJ, TM, TN].every(n => Number.isInteger(n) && n >= 1 && n <= 512)) refuse('a tile size');
    if (BI % TM || BJ % TN) refuse(`${BI}×${BJ} is not a multiple of the ${TM}×${TN} patch`);
    if (lanes < 32 || lanes > 1024 || lanes % 32)
      refuse(`${lanes} lanes is not a warp multiple in [32, 1024]`);
    const kTile = kernelNamed(before.value, params.kernel!).contraction?.kTile ?? 1;
    const next = copy(before.value);
    const kernel = kernelNamed(next, params.kernel!);
    const { statement } = legal.tiling;
    kernel.contraction = {
      statement: statement.name,
      // `contractionOf` accepts only a member with a single outermost reduction, so this is the 0th
      reduction: 0,
      block: [BI, BJ],
      lane: [TM, TN],
      kTile,
      stage: [],
      buffer: 'single',
    };
    kernel.reasons.push(
      `one block per ${BI}×${BJ} tile of [${plain(statement.shape[0])}, ${plain(statement.shape[1])}] and one lane ` +
        `per ${TM}×${TN} patch of it (${lanes} lanes)`,
    );
    // The block and lane tiles only divide the *outputs*, which are independent of each other: the visit order of
    // each reduction is untouched here, and the gate finds it so.
    return { native: next, edits: 1 };
  },
});

/** Replace a member's reduction nest by a strip-mine of the reduction axis: the strip outside, the axis inside. */
function setNest(
  kernel: ScheduleKernel,
  statement: string,
  axis: string,
  extent: { constant: number; terms: [string, number][] },
  width: number,
) {
  const order = kernel.orders.find(o => o.statement === statement);
  if (!order) return;
  if (!order.nest.every(level => level.axis === axis)) return;
  order.nest = [
    { axis, kind: 'strip', extent, width },
    { axis, kind: 'axis', extent },
  ];
}

/**
 * The strip-mine width of the reduction: `for k0 = 0, KC, … : for k = k0 … min(k0 + KC, K)`. The outer loop climbs
 * and the inner one climbs from it, so every output element still visits 0, 1, … K−1 once, in that order, with one
 * accumulator across both loops (the order analysis checks exactly this).
 */
export const scheduleTileReductionPass = definePass<ScheduleFunction, {}, ScheduleStepParams>({
  id: 'tensor.schedule-tile-reduction',
  version: '1',
  description: 'Strip-mine a tiled contraction’s reduction into passes of kTile terms, in order',
  ir: ScheduleIR,
  adapter: scheduleAdapter,
  writes: { entities: ['kernel'], relations: [] },
  run({ before, params }) {
    const kernel = kernelNamed(before.value, params.kernel!);
    const contraction = kernel.contraction;
    if (!contraction)
      throw new ScheduleRefusal('tensor.schedule-tile-reduction', `${kernel.name}: no tiling`);
    const legal = contractionOf(kernel, params.fn);
    if (!legal.ok) throw new ScheduleRefusal('tensor.schedule-tile-reduction', legal.reason);
    const kTile = params.kTile!;
    if (!Number.isInteger(kTile) || kTile < 1 || kTile > 512)
      throw new ScheduleRefusal('tensor.schedule-tile-reduction', `${kernel.name}: kTile ${kTile}`);
    if (legal.tiling.reduction.axes[0].extent.kind !== 'dim')
      throw new ScheduleRefusal(
        'tensor.schedule-tile-reduction',
        `${kernel.name}: its reduction is already split (a blocks or tail extent)`,
      );
    const next = copy(before.value);
    const target = kernelNamed(next, params.kernel!);
    target.contraction!.kTile = kTile;
    target.reasons.push(
      `its reduction is strip-mined into passes of ${kTile} terms, in order, into one accumulator per output`,
    );
    setNest(target, contraction.statement, legal.tiling.axis, legal.tiling.extent, kTile);
    return { native: next, edits: 1 };
  },
});

/** The shared memory one block of a tiled contraction may use; the GB10 opts in to 99 KiB, a tenth left over. */
export const sharedLimit = 90 * 1024;

/**
 * Stage an operand's tile in shared memory. Every lane of a block reads the same row of the rows operand and the same
 * column of the columns operand, so the tile turns a per-lane global read into one per block.
 */
export const scheduleStageOperandPass = definePass<ScheduleFunction, {}, ScheduleStepParams>({
  id: 'tensor.schedule-stage-operand',
  version: '1',
  description: 'Copy a tiled contraction’s operand strip into shared memory',
  ir: ScheduleIR,
  adapter: scheduleAdapter,
  writes: { entities: ['kernel'], relations: [] },
  run({ before, params }) {
    const kernel = kernelNamed(before.value, params.kernel!);
    const contraction = kernel.contraction;
    if (!contraction) throw new ScheduleRefusal('tensor.schedule-stage-operand', `${kernel.name}: no tiling`);
    const legal = contractionOf(kernel, params.fn);
    if (!legal.ok) throw new ScheduleRefusal('tensor.schedule-stage-operand', legal.reason);
    const stage = [...(params.stage ?? [])];
    if (stage.some(s => s !== 'a' && s !== 'b'))
      throw new ScheduleRefusal(
        'tensor.schedule-stage-operand',
        `${kernel.name}: stages ${stage.join(', ')}`,
      );
    const buffer = params.buffer ?? 'single';
    if (buffer !== 'single')
      throw new ScheduleRefusal(
        'tensor.schedule-stage-operand',
        `${kernel.name}: two buffers need a prefetch that overlaps the copy (later work)`,
      );
    const [BI, BJ] = contraction.block,
      KC = contraction.kTile;
    const bytes = 4 * ((stage.includes('a') ? BI * KC : 0) + (stage.includes('b') ? KC * BJ : 0));
    if (bytes > sharedLimit)
      throw new ScheduleRefusal(
        'tensor.schedule-stage-operand',
        `${kernel.name}: ${bytes} bytes of tiles exceed ${sharedLimit}`,
      );
    const next = copy(before.value);
    const target = kernelNamed(next, params.kernel!);
    target.contraction!.stage = stage;
    target.contraction!.buffer = buffer;
    if (stage.length)
      target.reasons.push(
        `the ${stage.map(s => (s === 'a' ? 'rows' : 'columns') + ' operand').join(' and ')} strip is copied into ` +
          `${bytes} bytes of shared memory per k-tile`,
      );
    return { native: next, edits: 1 };
  },
});

export type SchedulePass = typeof scheduleBuildPass;

export interface ScheduleStep {
  pass: string;
  version: string;
  params: Readonly<Record<string, unknown>>;
  applied: boolean;
  changed?: boolean;
  edits?: number;
  /** Why the IR did not allow the step. */
  refusal?: string;
}

export interface ScheduleRun {
  schedule: ScheduleFunction;
  steps: ScheduleStep[];
}

/**
 * Apply one scheduling step: the pass's own legality, then the framework's diff, correspondence and writes check,
 * then the gate (the accumulation order). A refusal is recorded, not thrown, so a strategy can carry on.
 */
export function applyScheduleStep(
  pass: typeof scheduleBuildPass | typeof scheduleTileDomainPass | typeof scheduleTileReductionPass,
  before: Artifact<any>,
  params: ScheduleStepParams,
  outputId?: string,
): { artifact: Artifact<ScheduleFunction>; step: ScheduleStep; result?: PassResult<ScheduleFunction> } {
  const logged: Readonly<Record<string, unknown>> = Object.fromEntries(
    Object.entries(params).filter(([key, value]) => key !== 'fn' && value !== undefined),
  );
  const name = { pass: pass.id, version: pass.version, params: logged };
  try {
    const result = applyNativePassSync(
      pass as never,
      before,
      scheduleGate,
      params,
      outputId,
    ) as PassResult<ScheduleFunction>;
    return {
      artifact: result.artifact,
      result,
      step: {
        ...name,
        applied: true,
        changed: result.changed,
        edits: result.edits,
      },
    };
  } catch (error) {
    if (error instanceof ScheduleRefusal)
      return {
        artifact: before as Artifact<ScheduleFunction>,
        step: { ...name, applied: false, refusal: error.message },
      };
    if (error instanceof PassError)
      return {
        artifact: before as Artifact<ScheduleFunction>,
        step: { ...name, applied: false, refusal: error.message },
      };
    throw error;
  }
}

/** The Tix artifact a schedule is of, for a caller that has only the function. */
export function tixArtifact(fn: Fn): Artifact<{ functions: Fn[] }> {
  return createArtifact(TixIR, 'tix', { functions: [fn] });
}
