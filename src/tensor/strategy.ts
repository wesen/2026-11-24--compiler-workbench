// IRWB-033-D: the rule that schedules a Tix function, as a sequence of checked passes on the schedule IR.
//
// src/framework/strategy would express this as a plan of apply and forEach nodes, but its interpreter is
// asynchronous and `cudaSource` is synchronous by the fixed API, so the rule is this function (design-doc/01).
// Every step is applied by the framework (applyNativePassSync), refused before it runs when its legality fails,
// and gated by the accumulation-order analysis.
import type { Artifact } from '../framework/core/types.js';
import { planFusion, unfusedPlan, type FusionPlan } from './fusion.js';
import {
  applyStep,
  bindPass,
  contractionPass,
  initialSchedule,
  isolatePass,
  reorderPass,
  selectPass,
  splitPass,
  stagePass,
  variantPass,
  type ContractionKernel,
  type Dim,
  type Schedule,
} from './schedule.js';
import type { Expr, Fn } from './model.js';

/**
 * Tile configurations (probe 01, scripts/01-tile-probe.out.json: exact hand-written kernels of this form at the
 * brief's contraction shapes). 128 x 64 with 8 x 4 per thread was fastest at 4096^3 (15.7 ms against 16.8 to 33.8
 * for the others); 32 x 32 with 4 x 4 at 512^3, attention's score and mlp's y (0.044, 0.023, 0.086 ms); 32 x 32 with
 * 2 x 2 (four times the threads per block) when the grid is small, at attention's out (0.046 against 0.055).
 */
export const tiles = [
  { bm: 128, bn: 64, bk: 8, tm: 8, tn: 4 },
  { bm: 32, bn: 32, bk: 8, tm: 4, tn: 4 },
  { bm: 32, bn: 32, bk: 8, tm: 2, tn: 2 },
];
/** Launch rule: blocks per SM a variant's grid needs to be chosen (variants 1..3 are `tiles`; see selectionNote). */
export const selection = [
  { variant: 1, minBlocks: 16 },
  { variant: 2, minBlocks: 2 },
  { variant: 3, minBlocks: 0 },
];

export interface ScheduleStep {
  pass: string;
  params: unknown;
  changed: boolean;
}

/** The dim whose innermost axis the operand's last index steps by 1: consecutive threads copy along it. */
function fastDim(k: ContractionKernel, fn: Fn, operand: 'm' | 'n'): Dim {
  const s = fn.statements.find(t => t.name === k.contraction)!;
  let load: Extract<Expr, { kind: 'load' }> | undefined;
  const find = (e: Expr) => {
    if (e.kind === 'load' && e.name === k.operands[operand] && !load) load = e;
    if (e.kind === 'op') e.args.forEach(find);
    if (e.kind === 'reduce') find(e.body);
  };
  find(s.expr);
  const last = load!.indices.at(-1)!;
  const unit = (d: Dim) => last.terms.some(([n, c]) => n === k.dims[d].at(-1) && c === 1);
  return unit(operand) ? operand : unit('r') ? 'r' : operand;
}

const memo = new Map<string, { schedule: Artifact<Schedule>; steps: ScheduleStep[] }>();
/** The scheduled function; the same function and plan always give the same schedule, so it is computed once. */
export function scheduleFunction(
  fn: Fn,
  plan: FusionPlan,
  fuse: boolean,
): { schedule: Artifact<Schedule>; steps: ScheduleStep[] } {
  const key = JSON.stringify([fn, plan, fuse]);
  if (!memo.has(key)) memo.set(key, schedule(fn, plan, fuse));
  return memo.get(key)!;
}
function schedule(fn: Fn, plan: FusionPlan, fuse: boolean) {
  let current = initialSchedule(fn, plan);
  const steps: ScheduleStep[] = [];
  if (!fuse) return { schedule: current, steps };
  const apply = <P>(pass: Parameters<typeof applyStep<P>>[0], params: P, optional = false) => {
    try {
      const result = applyStep(pass, current, params);
      current = result.artifact;
      steps.push({ pass: pass.id, params, changed: result.changed });
    } catch (error) {
      if (!optional || (error as { code?: string }).code !== 'illegal') throw error;
    }
  };
  apply(isolatePass, {}, true);
  for (const k of current.value.kernels) {
    if (k.kind !== 'pointwise') continue;
    apply(contractionPass, { kernel: k.name }, true);
    const c = current.value.kernels.find(x => x.name === k.name)!;
    if (c.kind !== 'contraction') continue;
    for (const t of tiles) {
      apply(variantPass, { kernel: k.name });
      const v = {
        kernel: k.name,
        variant:
          (current.value.kernels.find(x => x.name === k.name) as ContractionKernel).variants.length - 1,
      };
      apply(splitPass, { ...v, loop: 'm.0', factor: t.tm });
      apply(splitPass, { ...v, loop: 'm.0', factor: t.bm / t.tm });
      apply(splitPass, { ...v, loop: 'n.0', factor: t.tn });
      apply(splitPass, { ...v, loop: 'n.0', factor: t.bn / t.tn });
      apply(splitPass, { ...v, loop: 'r.0', factor: t.bk });
      apply(reorderPass, { ...v, order: ['b.0', 'm.0', 'n.0', 'm.1', 'n.1', 'r.0', 'r.1', 'm.2', 'n.2'] });
      for (const [loop, target] of [
        ['b.0', 'block.z'],
        // n tiles on blockIdx.x, so consecutive blocks share the m operand's tile row (probe 04 at 512^3: 0.050 to
        // 0.044 ms for variant 2; blockIdx.y also bounds the m tiles at 65,535, past which the host takes variant 0)
        ['m.0', 'block.y'],
        ['n.0', 'block.x'],
        ['m.1', 'thread.y'],
        ['n.1', 'thread.x'],
        ['r.1', 'unroll'],
        ['m.2', 'unroll'],
        ['n.2', 'unroll'],
      ] as const)
        apply(bindPass, { ...v, loop, target });
      for (const operand of ['m', 'n'] as const)
        apply(stagePass, { ...v, operand, at: 'r.0', fast: fastDim(c, fn, operand) });
    }
    apply(selectPass, { kernel: k.name, rule: selection });
  }
  return { schedule: current, steps };
}

/** The schedule of a Tix function: fused (planFusion, then the passes) or stage 2's one kernel per statement. */
export function lowerSchedule(fn: Fn, fuse: boolean): Artifact<Schedule> {
  return scheduleFunction(fn, fuse ? planFusion(fn) : unfusedPlan(fn), fuse).schedule;
}
