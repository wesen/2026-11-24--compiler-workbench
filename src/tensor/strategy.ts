// IRWB-033-D, IRWB-057: the rule that schedules a Tix function, as a strategy plan run under `executeSync`.
//
// The plan is four nodes: decide the fusion, apply it, decide the loop nests, apply them. Each decision is an
// analysis algorithm whose result, a serializable plan, is bound and handed to the transformation as its argument
// (K6: decisions as data). The decisions below are policy and are not trusted: `fusePass` and `loopsPass`
// (schedule.ts) check each plan with `eligible` before applying it, and the execution records hold both plans.
import type { Artifact } from '../framework/core/types.js';
import { passAlgorithm } from '../framework/passes/index.js';
import {
  AlgorithmRegistry,
  algorithm,
  apply,
  binding,
  executeSync,
  plan,
  require,
  sequence,
  StrategyExecutionError,
  type StrategyAlgorithm,
  type StrategyExecution,
} from '../framework/strategy/index.js';
import { decideFusion, fusionPlan, type FusionChoice } from './fusion.js';
import {
  contractionForm,
  contractionOf,
  dimsInOrder,
  fusePass,
  initialSchedule,
  loopsPass,
  type Bind,
  type Dim,
  type KernelLoops,
  type Loop,
  type LoopPlan,
  type Schedule,
  type Selection,
  type Variant,
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
/**
 * Launch rule (script 03 --variants, scripts/03-variants.out.jsonl; medians of 5 benchmark calls per variant):
 *  - variant 1 (128 x 64) only with at least 16 blocks per SM (768 on the GB10): at 4096^3 (2,048 blocks) it was
 *    the fastest; with 128 blocks (mlp's h) it tied variant 2 and with 32 (512^3) it lost (0.062 against 0.046);
 *  - variant 2 (32 x 32, 4 x 4) with at least 2 blocks per SM and 256 terms: it won at 256 to 1,024 terms with 256
 *    to 1,024 blocks (512^3 0.046 against 0.066; mlp's h 0.079 against 0.110; mlp's y 0.085 against 0.127) and lost
 *    to variant 3 at 64 and 144 terms (attention's score 0.036 against 0.032; conv2d 0.110 against 0.100) and with
 *    64 blocks (attention's out 0.055 against 0.047). The thresholds are the smallest measured values at which it won;
 *    the ranges between (2 to 5 blocks per SM, 145 to 255 terms) are not measured;
 *  - variant 3 with at least 1 block per SM: with one block (a dot product, 1 x 1 x 4096) it took 1.62 times
 *    stage 2's time; with 64 blocks (256 x 256 x 1) 0.94 and with 128 (4096 x 1 x 1024) 0.59 (script 06);
 *  - variant 0 (one thread per output, stage 2's mapping) otherwise.
 */
export const selection: Selection[] = [
  { variant: 1, minBlocks: 16 },
  { variant: 2, minBlocks: 2, minTerms: 256 },
  { variant: 3, minBlocks: 1 },
  { variant: 0, minBlocks: 0 },
];

/**
 * The fusion decision: the greedy grouping; when it puts a tileable contraction in a block-mode kernel, the
 * grouping in which every tileable contraction starts its own kernel and stays in thread mode (fission, so that
 * the contraction can be tiled).
 */
export function chooseFusion(fn: Fn): FusionChoice {
  const greedy = decideFusion(fn);
  const tileable = new Set(
    fn.statements.filter(s => typeof contractionForm(s) !== 'string').map(s => s.name),
  );
  const blocked = fusionPlan(fn, greedy).groups.some(
    g => g.mapping === 'block' && g.statements.some(n => tileable.has(n)),
  );
  return blocked ? decideFusion(fn, { noBlock: tileable }) : greedy;
}

/** The dim whose innermost axis the operand's last index steps by 1: consecutive threads copy along it. */
function fastDim(
  fn: Fn,
  contraction: string,
  dims: Record<Dim, string[]>,
  tensor: string,
  operand: 'm' | 'n',
): Dim {
  const s = fn.statements.find(t => t.name === contraction)!;
  let load: Extract<Expr, { kind: 'load' }> | undefined;
  const find = (e: Expr) => {
    if (e.kind === 'load' && e.name === tensor && !load) load = e;
    if (e.kind === 'op') e.args.forEach(find);
    if (e.kind === 'reduce') find(e.body);
  };
  find(s.expr);
  const last = load!.indices.at(-1)!;
  const unit = (d: Dim) => last.terms.some(([n, c]) => n === dims[d].at(-1) && c === 1);
  return unit(operand) ? operand : unit('r') ? 'r' : operand;
}

const loop = (dim: Dim, level: number, factor: number | null, bind: Bind): Loop => ({
  id: `${dim}.${level}`,
  dim,
  level,
  factor,
  bind,
});
/**
 * The loop decision: every pointwise kernel with a tileable contraction gets variant 0 (one thread per output,
 * stage 2's mapping) and one tiled variant per entry of `tiles`, with the launch rule `selection`. A tiled variant
 * is a grid of bm x bn output tiles (m tiles on blockIdx.y, n tiles on blockIdx.x), tm x tn outputs per thread, and
 * the reduction in steps of bk terms, with both operand tiles staged in shared memory at each step.
 */
export function chooseLoops(s: Schedule): LoopPlan {
  const kernels: KernelLoops[] = [];
  for (const k of s.kernels) {
    const found = contractionOf(s, k.name);
    if (typeof found === 'string') continue;
    const { statement, form } = found;
    const plainVariant: Variant = {
      loops: dimsInOrder.map(dim => loop(dim, 0, null, dim === 'r' ? 'serial' : 'thread')),
      stages: [],
    };
    const tiled = tiles.map(
      (t): Variant => ({
        loops: [
          loop('b', 0, null, 'block.z'),
          // n tiles on blockIdx.x, so consecutive blocks share the m operand's tile row (probe 04 at 512^3: 0.050
          // to 0.044 ms for variant 2; blockIdx.y also bounds the m tiles at 65,535, past which the host takes
          // variant 0)
          loop('m', 0, null, 'block.y'),
          loop('n', 0, null, 'block.x'),
          loop('m', 1, t.bm / t.tm, 'thread.y'),
          loop('n', 1, t.bn / t.tn, 'thread.x'),
          loop('r', 0, null, 'serial'),
          loop('r', 1, t.bk, 'unroll'),
          loop('m', 2, t.tm, 'unroll'),
          loop('n', 2, t.tn, 'unroll'),
        ],
        stages: (['m', 'n'] as const).map(operand => ({
          operand,
          at: 'r.0',
          scope: 'shared' as const,
          fast: fastDim(s.fn, statement, form.dims, form.operands[operand], operand),
        })),
      }),
    );
    kernels.push({ kernel: k.name, variants: [plainVariant, ...tiled], select: selection });
  }
  return { kernels };
}

const decision = (id: string, description: string, decide: (s: Schedule) => unknown): StrategyAlgorithm => ({
  id,
  version: '1',
  kind: 'analysis',
  description,
  run: (_ctx, input) => decide((input as Artifact<Schedule>).value),
});
const fuseDecision = decision('tensor.schedule.decide-fuse', 'Choose the fusion grouping', s =>
    chooseFusion(s.fn),
  ),
  loopsDecision = decision('tensor.schedule.decide-loops', 'Choose the loop nests', chooseLoops);
export const scheduleRegistry = new AlgorithmRegistry()
  .register(fuseDecision)
  .register(passAlgorithm(fusePass))
  .register(loopsDecision)
  .register(passAlgorithm(loopsPass));
const ref = (a: { id: string; version: string }) => algorithm(a.id, a.version);
/** The scheduling rule: each decision is bound, then applied by the transformation that checks it. */
export const schedulePlan = plan(
  'tix.schedule',
  sequence(
    'schedule',
    require('decide-fuse', ref(fuseDecision), 'fusion'),
    apply('fuse', ref(fusePass), { args: binding('fusion') }),
    require('decide-loops', ref(loopsDecision), 'loops'),
    apply('loops', ref(loopsPass), { args: binding('loops') }),
  ),
  'Fuse statements into kernels, then tile the contraction kernels',
);

export interface Scheduled {
  schedule: Artifact<Schedule>;
  /** The plan's execution, with both decisions in its records; undefined for the unfused schedule. */
  execution?: StrategyExecution;
}
const memo = new Map<string, Scheduled>();
/**
 * The scheduled function: fused (`schedulePlan`), or stage 2's one kernel per statement. The same function always
 * gives the same schedule, so it is computed once.
 */
export function scheduleFunction(fn: Fn, fuse: boolean): Scheduled {
  const key = JSON.stringify([fn, fuse]);
  let result = memo.get(key);
  if (!result) {
    const initial = initialSchedule(fn);
    if (!fuse) result = { schedule: initial };
    else {
      const execution = executeSync(schedulePlan, scheduleRegistry, initial);
      if (execution.status !== 'succeeded') throw new StrategyExecutionError(execution);
      result = { schedule: execution.value as Artifact<Schedule>, execution };
    }
    memo.set(key, result);
  }
  return result;
}

/** The schedule of a Tix function: fused and tiled, or stage 2's one kernel per statement. */
export function lowerSchedule(fn: Fn, fuse: boolean): Artifact<Schedule> {
  return scheduleFunction(fn, fuse).schedule;
}
