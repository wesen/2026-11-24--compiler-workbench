// IRWB-033-H: the schedule IR — the artifact between Tix and CUDA that holds every layout decision, the passes
// that make those decisions, and the analysis that proves a layout keeps every output's accumulation order.
// (design-doc/01 in the ticket.)
//
// Tix says *what* each statement computes, including the order a reduction accumulates its terms in. The schedule
// adds only *how* the work is laid out: which statements share a kernel (stage 3's fusion plan), where a block's
// rows live, how wide a block is, and — new in this stage — how a contraction's reduction and output plane are
// tiled. The CUDA printer reads nothing else.
//
// The artifact carries the algorithm (the Tix function) as well as the layout, so that
//   - a schedule stands alone (the printer and the order analysis both need the algorithm), and
//   - the order analysis can compare the layout against the meaning in one value.
import { defineAnalysis, defineIR, type AnalysisDefinition } from '../framework/contracts/index.js';
import { createIRArtifact, defineAdapter, type IRRelation } from '../framework/ir/index.js';
import { applyNativePassSync, definePass, PassError, type Pass } from '../framework/passes/index.js';
import type { Artifact } from '../framework/core/types.js';
import { outerReductions, type FusionGroup, type FusionPlan, type Reduce } from './fusion.js';
import { plain, visit, type Affine, type Expr, type Fn, type Statement } from './model.js';

/** Factors of one output axis of a tiled contraction: block tile and the patch one thread owns. */
export interface Splits {
  block: number;
  thread: number;
}
/**
 * One layout a tiled contraction may run: the reduction tile, the block's tile of the output plane, and the patch
 * of outputs one thread owns. The shapes are known at launch and not at compile time, so a kernel is printed with
 * several variants and the host picks one (`choice`); every variant keeps the reduction's order, which the order
 * analysis checks once because `Contraction.order` is not per variant.
 */
export interface Variant {
  tile: number;
  blockRows: number;
  blockCols: number;
  patchRows: number;
  patchCols: number;
}
/** Which way a level of a split reduction index runs. */
export type Order = 'ascending' | 'descending';

/**
 * A contraction tiled in shared memory: the reduction axis is the reduction of the statement, `a[i,k] * b[k,j]`
 * is the body, `i` and `j` are the statement's axes 0 and 1.
 *
 * `reduction.order` names the order of the two loop levels the axis is split into, outermost first. It is IR data
 * rather than a convention of the printer: the order analysis reads it, and it is an axis and two levels — so the
 * same record can carry a split reduction whose levels interleave differently when a later stage allows it.
 */
export interface Contraction {
  axis: string;
  /** The order of the two loop levels the reduction axis is split into, outermost first. */
  order: { outer: Order; inner: Order };
  /** Both operand tiles live in shared memory. */
  stage: 'shared';
  /** The tiles that are complete are run without a bound; the remainder is peeled after them. */
  peelTail: boolean;
  unroll: { reduction: boolean; patch: boolean };
  doubleBuffer: boolean;
  /** The layouts the launch may pick from: variants[0] is the primary one, the rest are alternatives. */
  variants: Variant[];
  /** How the launch picks: the cost model below, over the shape values and the device's limits. */
  choice: 'cost';
  /**
   * The kernel also holds the statement's stage-2 form (one thread per output element), and the launch runs it when
   * the tiled form's grid is smaller than the device's SM count. Measured (script 04, as written): a tiled
   * contraction is 3 to 6 times faster than that form from 512^3 up, where the output plane gives at least one
   * block per SM (512^3: 64 blocks over 48 SMs, 0.072 against 0.214 ms), and slower below it (300x200x100: 10
   * blocks, 0.031 against 0.013 ms; 128^3: 16 blocks, 0.021 against 0.011; 17x4096x33: 1 block, 0.453 against
   * 0.169).
   */
  fallback: boolean;
}

// The cost model the host evaluates at launch (printed by the emitter, `costVariant`). It is arithmetic over the
// schedule and the shapes: no measurement is taken. `flopsPerSm` is the GPU's measured FMUL+FADD ceiling divided
// by its SM count; `fillBlocks` is the number of resident blocks at which an SM was measured to saturate (a grid
// with fewer blocks than that runs proportionally under-filled, which is why 32x32 tiles won at 512^3 where 64x64
// leaves 64 blocks for 48 SMs, and 64x64 won at 4096^3).
export const costModel = {
  flopsPerSm: 14.39e12 / 48,
  fillBlocks: 4,
  minFill: 0.25,
  smBlocks: 24,
  smThreads: 1536,
  smShared: 102400,
};

export interface KernelSchedule {
  kernel: string;
  /** Member statements, in the order the kernel computes them. */
  statements: string[];
  /** Rank of the block domain (stage 3's fusion depth). */
  depth: number;
  mapping: 'thread' | 'block' | 'gemm';
  stored: string[];
  buffered: string[];
  staged: string[];
  terms: { statement: string; reduction: number }[];
  inPlace: { statement: string; over: string }[];
  heavy: string[];
  gated: boolean;
  /** Block mode: threads per block. `cap` is the rule's cap; the launch narrows it to the longest row. */
  threads: { kind: 'cap'; cap: number } | { kind: 'heavy'; cap: number };
  /** Block mode: `auto` keeps the rows in shared memory when they fit and in scratch otherwise (a runtime test). */
  rowMap: 'auto';
  /** Block mode: the launch-time choice between the fused kernel and its statements one by one (stage 3b). */
  gate: { fullRow: number; smallGrid: number; heavyLanes: [number, number] } | null;
  /** Why this layout, printed as a comment beside the kernel. */
  reasons: string[];
  contraction?: Contraction;
}

/** One applied schedule pass, as the lowering reports it (evidence, not part of the artifact). */
export interface Step {
  pass: string;
  version: string;
  args: unknown;
  /** Revision after the step, so the chain of revisions is reported. */
  revision: string;
  changed: boolean;
}

export interface Schedule {
  fn: string;
  algorithm: Fn;
  kernels: KernelSchedule[];
}

const threadCaps = { contraction: 64, rows: 128, heavy: 256 };

function validateContraction(c: Contraction, m: Statement) {
  const bad = (reason: string) => {
    throw Error('Invalid contraction: ' + reason);
  };
  if (typeof c.axis !== 'string' || !c.axis) bad('no reduction axis');
  const positive = (n: unknown) => Number.isSafeInteger(n) && (n as number) > 0;
  if (
    !['ascending', 'descending'].includes(c.order?.outer) ||
    !['ascending', 'descending'].includes(c.order?.inner)
  )
    bad('order');
  if (!Array.isArray(c.variants) || !c.variants.length) bad('no layout variant');
  if (c.choice !== 'cost') bad('choice');
  if (typeof c.fallback !== 'boolean') bad('fallback');
  for (const v of c.variants) {
    if (!positive(v.tile) || !v.tile) bad('tile');
    for (const [name, block, patch] of [
      ['rows', v.blockRows, v.patchRows],
      ['cols', v.blockCols, v.patchCols],
    ] as const) {
      if (!positive(block) || !positive(patch)) bad(name);
      if (block % patch) bad(`${name} tile is not a multiple of the thread patch`);
    }
    const threads = (v.blockRows / v.patchRows) * (v.blockCols / v.patchCols);
    if (!positive(threads) || threads > 1024) bad('threads');
  }
  if (c.stage !== 'shared') bad('stage');
  if (typeof c.peelTail !== 'boolean' || typeof c.doubleBuffer !== 'boolean') bad('flags');
  if (!c.unroll || typeof c.unroll.reduction !== 'boolean' || typeof c.unroll.patch !== 'boolean')
    bad('unroll');
  if (m.axes.length !== 2) bad('the statement is not rank 2');
  if (!plain(m.shape[0]) || !plain(m.shape[1])) bad('the output extents are not plain');
  const reduction = outerReductions(m.expr);
  if (reduction.length !== 1 || reduction[0].axes.length !== 1)
    bad('the statement is not one single-axis reduction');
  if (reduction[0].axes[0].id !== c.axis) bad('the reduction axis is not the contraction axis');
}

function validateKernel(k: KernelSchedule, f: Fn) {
  const bad = (reason: string) => {
    throw Error('Invalid kernel schedule: ' + reason);
  };
  const names = new Set(f.statements.map(s => s.name));
  if (typeof k.kernel !== 'string' || !k.kernel) bad('no kernel name');
  if (!Array.isArray(k.statements) || !k.statements.length || k.statements.some(s => !names.has(s)))
    bad('unknown member statement');
  if (!['thread', 'block', 'gemm'].includes(k.mapping)) bad('mapping');
  if (!Number.isSafeInteger(k.depth) || k.depth < 1 || k.depth > 8) bad('depth');
  for (const list of [k.stored, k.buffered, k.staged, k.heavy, k.reasons])
    if (!Array.isArray(list) || list.some(s => typeof s !== 'string')) bad('member list');
  if (k.mapping === 'gemm') {
    if (k.statements.length !== 1) bad('a tiled contraction computes one statement');
    if (!k.contraction) bad('a tiled contraction has no layout');
    validateContraction(k.contraction as Contraction, f.statements.find(s => s.name === k.statements[0])!);
  } else if (k.contraction !== undefined) bad('a contraction layout on a kernel that is not tiled');
}

function validate(value: unknown) {
  const s = value as Schedule;
  if (!s || typeof s.fn !== 'string' || !s.fn) throw Error('Invalid schedule: no function name');
  if (!s.algorithm || !Array.isArray(s.algorithm.statements)) throw Error('Invalid schedule: no algorithm');
  if (!Array.isArray(s.kernels)) throw Error('Invalid schedule: no kernels');
  if (s.algorithm.name !== s.fn) throw Error('Invalid schedule: the algorithm is another function');
  const f = s.algorithm;
  if (new Set(s.kernels.map(k => k.kernel)).size !== s.kernels.length)
    throw Error('Invalid schedule: duplicate kernel name');
  const members = s.kernels.flatMap(k => k.statements);
  if (new Set(members).size !== members.length)
    throw Error('Invalid schedule: a statement is in two kernels');
  if (members.length !== f.statements.length) throw Error('Invalid schedule: a statement is in no kernel');
  s.kernels.forEach(k => validateKernel(k, f));
}

export const ScheduleIR = defineIR<Schedule>({
  id: 'tensor.schedule',
  version: '1',
  description: 'A Tix function with the layout of every kernel decided: mapping, rows, block width, tiling',
  validate,
  entities: s => s.kernels.flatMap(k => [k.kernel, ...k.statements.map(n => k.kernel + '/' + n)]),
});

function* entities(s: Schedule) {
  for (const k of s.kernels) {
    yield { id: k.kernel, kind: 'kernel', attributes: { mapping: k.mapping, depth: k.depth } };
    for (const n of k.statements)
      yield {
        id: k.kernel + '/' + n,
        kind: 'statement',
        attributes: { statement: n, knot: k.contraction ?? null },
      };
  }
}
function* relations(s: Schedule): Generator<IRRelation> {
  for (const k of s.kernels)
    for (const n of k.statements)
      yield {
        id: 'computes/' + k.kernel + '/' + n,
        from: k.kernel,
        to: k.kernel + '/' + n,
        kind: 'computes',
        category: 'containment',
      };
}

export const adapter = defineAdapter<Schedule>({
  id: 'tensor.schedule.adapter',
  version: '1',
  description: 'Kernels of a scheduled function and the statements each computes',
  kind: ScheduleIR.id,
  schemaVersion: ScheduleIR.version,
  validate,
  relationKinds: { computes: 'containment' },
  entities,
  relations,
  resolve: (s, id) => [...entities(s)].find(e => e.id === id),
  describe: (_, id) => ({ label: id }),
});

export function scheduleArtifact(schedule: Schedule, id = 'tix-schedule/' + schedule.fn): Artifact<Schedule> {
  return createIRArtifact(adapter, id, schedule);
}

/** The schedule the fusion plan asks for, before any pass: the fallback that is legal for every program. */
export function scheduleFromPlan(fn: Fn, plan: FusionPlan): Schedule {
  const capOf = (g: FusionGroup) => {
    if (g.mapping === 'thread') return threadCaps.rows;
    const members = new Map(fn.statements.map(s => [s.name, s]));
    const reads = g.statements.some(n => {
      let found = false;
      visit(members.get(n)!.expr, e => {
        if (e.kind === 'load' && !g.statements.includes(e.name) && !g.staged.includes(e.name)) found = true;
      });
      return found;
    });
    return g.heavy.length ? threadCaps.heavy : reads ? threadCaps.contraction : threadCaps.rows;
  };
  return {
    fn: fn.name,
    algorithm: fn,
    kernels: plan.groups.map(g => ({
      kernel: g.kernel,
      statements: [...g.statements],
      depth: g.depth,
      mapping: g.mapping,
      stored: [...g.stored],
      buffered: [...g.buffered],
      staged: [...g.staged],
      terms: g.terms.map(t => ({ ...t })),
      inPlace: g.inPlace.map(p => ({ ...p })),
      heavy: [...g.heavy],
      gated: g.gated,
      threads: { kind: g.heavy.length ? 'heavy' : 'cap', cap: capOf(g) },
      rowMap: 'auto',
      gate: g.gated ? { fullRow: 96, smallGrid: 1024, heavyLanes: [19, 24] } : null,
      reasons: [...g.reasons],
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The order analysis: what every layout pass must keep.

/**
 * The sequence of term indices of one reduction, as the meaning defines it and as a layout schedules it.
 *
 * The meaning's value is always `{ contiguous, from: '0', step: 1, count: <extent> }`: terms are added one at a
 * time in ascending order of the index, the first listed axis outermost. A layout that keeps that order — however
 * it tiles, splits or unrolls the loop — must produce the same value, and a layout that does not is a value the
 * gate can reject.
 */
export interface ReductionOrder {
  axis: string;
  shape: 'contiguous' | 'split';
  from: string;
  step: number;
  count: string;
  /** For a split order: the levels, so the counterexample says how it differs. */
  levels?: { outer: Order; inner: Order; tile: number };
}
export interface StatementOrder {
  kernel: string;
  statement: string;
  reductions: ReductionOrder[];
  /** Layout fields this analysis does not know; a change it cannot certify. */
  unrecognized: string[];
}
export interface OrderValue {
  fn: string;
  statements: StatementOrder[];
}

const contractionKeys = new Set([
  'axis',
  'order',
  'stage',
  'peelTail',
  'unroll',
  'doubleBuffer',
  'variants',
  'choice',
  'fallback',
]);

function affineText(a: Affine): string {
  const terms = a.terms.map(([n, k]) => (k === 1 ? n : `${k}*${n}`));
  if (a.constant || !terms.length) terms.unshift(String(a.constant));
  return terms.join(' + ');
}

/**
 * The term order of one reduction in one kernel, derived from the algorithm and the layout.
 *
 * A tiled reduction is `index = k0 * tile + kk` with `k0` over `ceil(K / tile)` levels and `kk` over
 * `min(tile, K - k0 * tile)` when the tail is peeled (the emitter prints exactly that). Ascending `k0` and
 * ascending `kk` visit 0, 1, … K-1 in order, which is the meaning's contiguous run; any other pair of orders
 * gives a value that is not the meaning's.
 */
function orderOfReduction(r: Reduce, contraction: Contraction | undefined): ReductionOrder[] {
  return r.axes.map(axis => {
    const count = affineText(axis.extent.dim);
    if (contraction && contraction.axis === axis.id && r.axes.length === 1)
      return contraction.order.outer === 'ascending' && contraction.order.inner === 'ascending'
        ? { axis: axis.id, shape: 'contiguous', from: '0', step: 1, count }
        : {
            axis: axis.id,
            shape: 'split',
            from: 'k0 * tile + kk',
            step: contraction.order.inner === 'ascending' ? 1 : -1,
            count,
            levels: { ...contraction.order, tile: 0 },
          };
    return { axis: axis.id, shape: 'contiguous', from: '0', step: 1, count };
  });
}

/** The accumulation order of every statement of every kernel: what a layout pass must not change. */
export function orderOf(schedule: Schedule): OrderValue {
  const statements = new Map(schedule.algorithm.statements.map(s => [s.name, s]));
  return {
    fn: schedule.fn,
    statements: schedule.kernels.flatMap(k => {
      const unrecognized =
        k.contraction === undefined
          ? []
          : Object.keys(k.contraction).filter(key => !contractionKeys.has(key));
      return k.statements.map(name => {
        const s = statements.get(name)!;
        return {
          kernel: k.kernel,
          statement: name,
          reductions: outerReductions(s.expr).flatMap(r => orderOfReduction(r, k.contraction)),
          unrecognized: [...unrecognized],
        };
      });
    }),
  };
}

const OrderType = {
  category: 'type',
  id: 'tensor.accumulation-order',
  version: '1',
  description: 'The order each output element of each statement adds its terms in',
  validate(value: unknown) {
    if (!value || typeof value !== 'object') throw Error('Invalid accumulation order');
  },
} as const;

export const accumulationOrder = defineAnalysis<Schedule, OrderValue>({
  id: 'tensor.accumulation-order',
  version: '1',
  description: 'For every statement and reduction, the order its terms are added in',
  input: ScheduleIR,
  output: OrderType as never,
  run: (_ctx, artifact) => orderOf(artifact.value),
});

/** The semantic gate of every layout pass: same algorithm, same statements per kernel, same term order. */
export function orderPreserved(before: Artifact<Schedule>, after: Artifact<Schedule>) {
  const a = orderOf(before.value),
    b = orderOf(after.value);
  if (JSON.stringify(before.value.algorithm) !== JSON.stringify(after.value.algorithm))
    return { ok: false as const, reason: 'The pass changed the algorithm' };
  const members = (s: Schedule) => s.kernels.map(k => [k.kernel, k.statements.join(',')].join(':')).join(';');
  if (members(after.value) !== members(before.value))
    return { ok: false as const, reason: 'The pass changed which statements share a kernel' };
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    const changed = b.statements.filter((s, i) => JSON.stringify(s) !== JSON.stringify(a.statements[i]))[0];
    return {
      ok: false as const,
      reason:
        `The pass changed the accumulation order of ${changed?.statement}` +
        (changed?.unrecognized.length
          ? ` (layout fields it does not know: ${changed.unrecognized.join(', ')})`
          : `: ${JSON.stringify(changed?.reductions)}`),
      evidence: { before: a, after: b },
    };
  }
  return { ok: true as const };
}

/**
 * Apply one schedule pass to one artifact: the framework's sync pass machinery (writes, correspondence, claims) with
 * the order analysis as both the claim and the gate.
 */
export function applySchedulePass<P>(
  pass: Pass<Schedule, {}, P>,
  before: Artifact<Schedule>,
  params?: P,
): Artifact<Schedule> {
  const result = applyNativePassSync(pass, before, orderPreserved, params, [accumulationOrder]);
  return result.artifact;
}

// ---------------------------------------------------------------------------------------------------------------
// The passes.

/** A pass that rewrites one kernel's schedule; it sees the whole schedule and returns a new one. */
export function layoutPass<P>(spec: {
  id: string;
  description: string;
  /** Legality, decided from the artifact before the pass runs; it returns the kernel it changes. */
  legal: (
    schedule: Schedule,
    params: P,
  ) => { kernel: KernelSchedule; change: KernelSchedule } | { refuse: string };
  run?: (schedule: Schedule, params: P) => Schedule;
}) {
  return definePass<Schedule, {}, P>({
    id: spec.id,
    version: '1',
    description: spec.description,
    ir: ScheduleIR,
    adapter,
    writes: { entities: ['kernel', 'statement'], relations: ['computes'] },
    run: ({ before, params }) => {
      const params_ = params as P;
      const verdict = spec.legal(before.value, params_);
      if ('refuse' in verdict) throw new PassError('passFailed', `${spec.id} refused: ${verdict.refuse}`);
      const next = spec.run
        ? spec.run(before.value, params_)
        : {
            ...before.value,
            kernels: before.value.kernels.map(k => (k.kernel === verdict.kernel.kernel ? verdict.change : k)),
          };
      if (next === before.value) return { native: before.value };
      return {
        native: next,
        correspondence: before.value.kernels.flatMap(k => {
          const ids = [k.kernel, ...k.statements.map(n => k.kernel + '/' + n)];
          return [{ from: ids, to: ids, relation: 'laid-out' }];
        }),
      };
    },
  });
}

/** The two-operand product a tiled contraction needs, or the reason the statement is not one. */
export function contractionOf(
  s: Statement,
): { loads: [string, string]; reduction: Reduce } | { refuse: string } {
  const refuse = (reason: string) => ({ refuse: `${s.name}: ${reason}` });
  const text = (a: Affine) => plain(a);
  if (s.axes.length !== 2 || !text(s.shape[0]) || !text(s.shape[1])) return refuse('not a rank-2 output');
  const reductions = outerReductions(s.expr);
  if (reductions.length !== 1) return refuse('not exactly one outermost reduction');
  const [r] = reductions;
  if (r.op !== 'sum' || r.axes.length !== 1) return refuse('the reduction is not a sum over one axis');
  let body: Expr = r.body;
  while (body.kind === 'op' && body.op === 'neg') body = body.args[0];
  if (body.kind !== 'op' || body.op !== '*' || body.args.length !== 2)
    return refuse('the reduction body is not a product of two loads');
  const [x, y] = body.args;
  if (x.kind !== 'load' || y.kind !== 'load')
    return refuse('the reduction body is not a product of two loads');
  const k = r.axes[0].id,
    i = s.axes[0].id,
    j = s.axes[1].id;
  const shape = (e: typeof x) => e.indices.map(text);
  if (JSON.stringify(shape(x)) !== JSON.stringify([i, k]))
    return refuse(`the first operand is not read at [${i}, ${k}]`);
  if (JSON.stringify(shape(y)) !== JSON.stringify([k, j]))
    return refuse(`the second operand is not read at [${k}, ${j}]`);
  if (x.name === s.name || y.name === s.name) return refuse('the statement reads itself');
  return { loads: [x.name, y.name], reduction: r };
}

/** `schedule.tile-reduction`: tiling a thread-mode contraction and staging both operands in shared memory. */
export const tileReduction = layoutPass<{ tile: number }>({
  id: 'schedule.tile-reduction',
  description: 'Split a rank-2 contraction reduction into a shared-memory tile and stage both operands',
  legal: (schedule, { tile }) => {
    const kernel = schedule.kernels.find(k => k.mapping === 'thread' && k.statements.length === 1);
    if (!kernel) return { refuse: 'no thread-mode kernel with one statement' };
    const s = schedule.algorithm.statements.find(x => x.name === kernel.statements[0])!;
    const found = contractionOf(s);
    if ('refuse' in found) return found;
    if (!Number.isSafeInteger(tile) || tile < 2) return { refuse: 'the tile is below 2' };
    if ((32 + 32) * tile * 4 > 48 * 1024)
      return { refuse: 'the smallest block tile does not fit shared memory' };
    return {
      kernel,
      change: {
        ...kernel,
        mapping: 'gemm',
        contraction: {
          axis: found.reduction.axes[0].id,
          order: { outer: 'ascending', inner: 'ascending' },
          stage: 'shared',
          peelTail: true,
          unroll: { reduction: false, patch: false },
          doubleBuffer: false,
          variants: [{ tile, blockRows: 32, blockCols: 32, patchRows: 1, patchCols: 1 }],
          choice: 'cost',
          fallback: false,
        },
      },
    };
  },
});

/** `schedule.bind-block-tile`: the block's tile of the output plane, which the grid runs over. */
export const bindBlockTile = layoutPass<{ rows: number; cols: number }>({
  id: 'schedule.bind-block-tile',
  description: 'Bind the output plane to blocks of rows x cols',
  legal: (schedule, { rows, cols }) => {
    const kernel = schedule.kernels.find(k => k.mapping === 'gemm');
    if (!kernel) return { refuse: 'no tiled contraction' };
    const c = kernel.contraction!;
    if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(cols) || rows < 1 || cols < 1)
      return { refuse: 'a tile must be a positive integer' };
    const v = c.variants[0];
    const check = checkVariant({ ...v, blockRows: rows, blockCols: cols });
    if ('refuse' in check) return check;
    return {
      kernel,
      change: {
        ...kernel,
        contraction: { ...c, variants: [{ ...v, blockRows: rows, blockCols: cols }, ...c.variants.slice(1)] },
      },
    };
  },
});

/** `schedule.bind-thread-patch`: how many outputs of the block's tile one thread owns, in registers. */
export const bindThreadPatch = layoutPass<{ rows: number; cols: number }>({
  id: 'schedule.bind-thread-patch',
  description: 'Give each thread a patch of rows x cols accumulators in registers',
  legal: (schedule, { rows, cols }) => {
    const kernel = schedule.kernels.find(k => k.mapping === 'gemm');
    if (!kernel) return { refuse: 'no tiled contraction' };
    const c = kernel.contraction!;
    if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(cols) || rows < 1 || cols < 1)
      return { refuse: 'a patch must be a positive integer' };
    const v = c.variants[0];
    const check = checkVariant({ ...v, patchRows: rows, patchCols: cols });
    if ('refuse' in check) return check;
    return {
      kernel,
      change: {
        ...kernel,
        contraction: { ...c, variants: [{ ...v, patchRows: rows, patchCols: cols }, ...c.variants.slice(1)] },
      },
    };
  },
});

/** `schedule.unroll`: unroll the reduction tile and the patch loops. */
export const unroll = layoutPass<{ reduction: boolean; patch: boolean }>({
  id: 'schedule.unroll',
  description: 'Unroll the reduction tile and the register patch',
  legal: (schedule, { reduction }) => {
    const kernel = schedule.kernels.find(k => k.mapping === 'gemm');
    if (!kernel) return { refuse: 'no tiled contraction' };
    const c = kernel.contraction!;
    if (reduction && !c.peelTail) return { refuse: 'the reduction tile has no complete-tile path to unroll' };
    return { kernel, change: { ...kernel, contraction: { ...c, unroll: { reduction, patch: true } } } };
  },
});

/** `schedule.double-buffer`: prefetch the next operand tiles while the current ones are in use. */
export const doubleBuffer = layoutPass<{}>({
  id: 'schedule.double-buffer',
  description: 'Stage two operand tiles and prefetch the next while the current one is in use',
  legal: schedule => {
    const kernel = schedule.kernels.find(k => k.mapping === 'gemm');
    if (!kernel) return { refuse: 'no tiled contraction' };
    const c = kernel.contraction!;
    if (c.variants.some(v => 2 * (v.blockRows + v.blockCols) * v.tile * 4 > 48 * 1024))
      return { refuse: 'two tiles of both operands exceed the default 48 KiB' };
    return { kernel, change: { ...kernel, contraction: { ...c, doubleBuffer: true } } };
  },
});

/**
 * `schedule.launch-variants`: the launch picks a layout from these, by the cost model, because the shapes are known
 * only at launch. Every variant has the same reduction order (`Contraction.order`), which the order analysis
 * certifies for the whole list at once.
 */
export const launchVariants = layoutPass<{ variants: Variant[]; fallback: boolean }>({
  id: 'schedule.launch-variants',
  description: 'Print several layouts of one tiled contraction and pick one at launch by the cost model',
  legal: (schedule, { variants, fallback }) => {
    const kernel = schedule.kernels.find(k => k.mapping === 'gemm');
    if (!kernel) return { refuse: 'no tiled contraction' };
    const c = kernel.contraction!;
    if (variants.length < 2) return { refuse: 'fewer than two variants is no choice' };
    for (const v of variants) {
      const check = checkVariant(v);
      if ('refuse' in check) return check;
      if (v.tile !== c.variants[0].tile && c.unroll.reduction)
        return { refuse: 'the reduction is unrolled, which a different tile would change' };
    }
    if (!variants.some(v => sameVariant(v, c.variants[0])))
      return { refuse: 'the primary layout is not among the variants' };
    return {
      kernel,
      change: { ...kernel, contraction: { ...c, variants: variants.map(v => ({ ...v })), fallback } },
    };
  },
});

/** Structural equality of two layouts, independent of the order their fields were written in. */
export function sameVariant(a: Variant, b: Variant): boolean {
  return (
    a.tile === b.tile &&
    a.blockRows === b.blockRows &&
    a.blockCols === b.blockCols &&
    a.patchRows === b.patchRows &&
    a.patchCols === b.patchCols
  );
}

/** The legality of one layout, shared by the three passes that set one. */
export function checkVariant(v: Variant): { ok: true } | { refuse: string } {
  const positive = (n: unknown) => Number.isSafeInteger(n) && (n as number) > 0;
  if (!positive(v.tile) || v.tile < 2) return { refuse: 'the reduction tile is below 2' };
  if (!positive(v.blockRows) || !positive(v.blockCols)) return { refuse: 'a block tile must be positive' };
  if (!positive(v.patchRows) || !positive(v.patchCols)) return { refuse: 'a patch must be positive' };
  if (v.blockRows % v.patchRows || v.blockCols % v.patchCols)
    return { refuse: 'a patch does not divide its block tile' };
  const threads = (v.blockRows / v.patchRows) * (v.blockCols / v.patchCols);
  if (threads < 32 || threads > 1024) return { refuse: `${threads} threads are outside 32..1024` };
  if (threads % 32) return { refuse: `${threads} threads are not a multiple of a warp` };
  if (v.patchRows * v.patchCols > 64)
    return { refuse: `${v.patchRows * v.patchCols} accumulators exceed the patch of 64` };
  if (v.patchRows + v.patchCols + v.patchRows * v.patchCols > 96)
    return {
      refuse: `${v.patchRows + v.patchCols + v.patchRows * v.patchCols} live registers exceed the budget of 96`,
    };
  if ((v.blockRows + v.blockCols) * v.tile * 4 > 48 * 1024)
    return {
      refuse: `${(v.blockRows + v.blockCols) * v.tile * 4} bytes of shared memory exceed the default 48 KiB`,
    };
  return { ok: true };
}

export const layoutPasses = {
  tileReduction,
  bindBlockTile,
  bindThreadPatch,
  unroll,
  doubleBuffer,
  launchVariants,
};
