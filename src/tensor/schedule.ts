// IRWB-033-F: the schedule IR, a v6 artifact between Tix and CUDA.
//
// The schedule holds the algorithm (the function's Tix statements, copied verbatim and never edited) and, per
// kernel, how to execute it: the fusion plan's constructs (groups, rows, staged terms, in-place rows, the gate)
// and, for a two-operand contraction, a tile schedule. Scheduling steps are v6 passes on this IR
// (`applyNativePassSync`): each decides its legality from the IR before it is applied, declares what it writes,
// preserves the schedule-order analysis and is checked against the meaning-ordered property. The emitter
// (cuda-source.ts) only prints a schedule; it decides nothing.
//
// Every output element still accumulates its terms one at a time in the meaning's order, rounding the product
// and the fold separately. The tile schedule changes only the layout around that order: output tiles bound to
// blocks, a register patch per thread, the reduction axis walked in ascending chunks, operand tiles staged in
// shared memory, masks for shapes that are not multiples of a tile. The schedule-order analysis states that
// order as data; each pass preserves it, and the property `tensor.schedule-ordered` checks the final schedule
// against the algorithm. What the IR checks do not cover — address arithmetic, masks, barriers, the dispatch
// rule, the epilogue — stays with the exact GPU differential, which runs every case on both sides of the gate.
import {
  Check,
  defineAnalysis,
  defineIR,
  defineProperty,
  JsonValue,
  type AnalysisDefinition,
  type CheckResult,
} from '../framework/contracts/index.js';
import { defineAdapter, createIRArtifact, type IREntity, type IRRelation } from '../framework/ir/index.js';
import { applyNativePassSync, definePass, PassError, type Pass } from '../framework/passes/index.js';
import type { Artifact } from '../framework/core/types.js';
import { outerReductions, planFusion, unfusedPlan, type FusionGroup } from './fusion.js';
import { plain, visit, type Expr, type Fn, type Statement, type Tensor } from './model.js';

// A contraction operand's place in the tile schedule. `i`/`j` name the output axis the load reads (at most one),
// `k` a load of the reduction axis alone.
export type TileClass = 'i' | 'j' | 'k';
export interface TileConfig {
  /** Output-tile rows (the i axis). */
  bm: number;
  /** Output-tile columns (the j axis). */
  bn: number;
  /** Reduction-axis chunk length. */
  bk: number;
  /** Patch rows per thread. */
  tm: number;
  /** Patch columns per thread. */
  tn: number;
}
export interface TileOperand {
  tensor: string;
  /** The load's indices as plain axis ids (the legality check guarantees they are plain). */
  indices: string[];
  cls: TileClass;
}
export interface TileSchedule {
  statement: string;
  reduce: { op: 'sum' | 'max'; axis: string };
  loads: TileOperand[];
  /** Instantiations, small tiles first; the launch rule picks by shape. */
  configs: TileConfig[];
  /** Operand tiles in shared memory (always true in v1; kept as data for the passes). */
  stage: boolean;
  /** `#pragma unroll` on the inner product loop: a straight line kept in order. */
  unroll: boolean;
  /** Stage the next chunk's tiles while folding the current one. */
  double: boolean;
  /** The launch rule's constants: prefer larger tiles while the grid covers `waves` device waves; below
   * `minWork` output elements the statement runs in stage 2's element mapping. */
  dispatch: { waves: number; minWork: number };
}
export type ScheduleKernel = FusionGroup & { tile?: TileSchedule };
export interface ScheduleRefusal {
  kernel: string;
  statement: string;
  reason: string;
}
export interface ScheduleUnit {
  fn: string;
  /** The algorithm: the function's statements, verbatim from the Tix IR. */
  statements: Statement[];
  params: Tensor[];
  kernels: ScheduleKernel[];
  refusals: ScheduleRefusal[];
}

/** The stage-6 tile tables, fixed by the config sweep (scripts 02, three rounds, median of three benchmark
 * calls each). Small tiles win while the grid cannot fill the device twice over; 128x128 tiles with an 8x8 patch
 * win at large sizes (fewer shared loads per multiply-add). The launch rule picks a config from the shapes;
 * nothing is measured at run time. */
export const tile = {
  configs: [
    { bm: 64, bn: 128, bk: 32, tm: 4, tn: 4 },
    { bm: 128, bn: 128, bk: 32, tm: 8, tn: 8 },
  ] as TileConfig[],
  dispatch: { waves: 2, minWork: 1 << 15 },
  /** Whether the strategy double-buffers the operand tiles. Measured (script 02, rounds 1 to 3): it doubles
   * the block's shared memory, halves the resident blocks, and lost beyond the 5% noise at 512^3 (0.0725
   * against 0.0749 ms) while costing 1.4 to 2.1x at 4096^3 on every configuration. The pass stays in the menu
   * and remains applicable; the strategy does not pick it. */
  doubleBuffer: false,
};
/** The GB10's opt-in shared-memory limit per block (IRWB-029-D probe 01: 101,376 bytes). */
export const sharedOptIn = 101376;

function requireSchedule(condition: unknown, reason: string): asserts condition {
  if (!condition) throw Error(reason);
}
/** Validate one kernel record (the fusion plan's invariants plus the tile schedule's). */
function validateKernel(unit: ScheduleUnit, kernel: ScheduleKernel) {
  requireSchedule(
    kernel.statements.length &&
      kernel.statements.every(s => unit.statements.some(t => t.name === s)) &&
      new Set(kernel.statements).size === kernel.statements.length,
    'Invalid kernel members',
  );
  requireSchedule(
    unit.statements.filter(s => kernel.statements.includes(s.name)).length === kernel.statements.length,
    'Kernel members repeated',
  );
  const t = kernel.tile;
  if (!t) return;
  requireSchedule(t.statement === kernel.statements[0] && kernel.statements.length === 1, 'Tiled kernel');
  requireSchedule(
    ['sum', 'max'].includes(t.reduce.op) && typeof t.reduce.axis === 'string',
    'Invalid tiled reduction',
  );
  requireSchedule(t.loads.length === 2, 'Tiled operands');
  for (const l of t.loads)
    requireSchedule(
      typeof l.tensor === 'string' &&
        l.indices.every(i => typeof i === 'string') &&
        l.indices.includes(t.reduce.axis) &&
        ['i', 'j', 'k'].includes(l.cls),
      'Invalid tiled operand',
    );
  requireSchedule(
    t.configs.length > 0 &&
      t.configs.every(
        c =>
          [c.bm, c.bn, c.bk, c.tm, c.tn].every(Number.isInteger) &&
          c.bm > 0 &&
          c.bn > 0 &&
          c.bk > 0 &&
          c.tm > 0 &&
          c.tn > 0 &&
          c.bm % c.tm === 0 &&
          c.bn % c.tn === 0 &&
          (c.bm / c.tm) * (c.bn / c.tn) <= 1024,
      ),
    'Invalid tile configuration',
  );
  requireSchedule(
    t.configs.every(c => (t.double ? 2 : 1) * tileSharedBytes(c, t.loads) <= sharedOptIn),
    'Tile configuration exceeds the shared-memory limit',
  );
  requireSchedule(
    Number.isInteger(t.dispatch.waves) &&
      t.dispatch.waves > 0 &&
      Number.isInteger(t.dispatch.minWork) &&
      t.dispatch.minWork >= 0,
    'Invalid dispatch rule',
  );
}

/** Shared-memory bytes one operand set needs: the i-tiles stride bk+1 (rows spread over banks), the j-tiles
 * stride bn+4 (16-byte rows for the float4 fold reads), the k-tiles a bare bk. */
export function tileSharedBytes(config: TileConfig, loads: readonly TileOperand[]): number {
  const floats =
    loads.reduce(
      (n, l) =>
        n +
        (l.cls === 'i'
          ? config.bm * (config.bk + 1)
          : l.cls === 'j'
            ? config.bk * (config.bn + 4)
            : config.bk),
      0,
    ) * 1;
  return floats * 4;
}

/** Every reduction of an expression, preorder, outermost first within each node. */
function allReductions(e: Expr): (Expr & { kind: 'reduce' })[] {
  const out: (Expr & { kind: 'reduce' })[] = [];
  visit(e, x => {
    if (x.kind === 'reduce') out.push(x as Expr & { kind: 'reduce' });
  });
  return out;
}

// The fold order a schedule performs, as data: one record per kernel member statement and reduction. `axes` is
// the fold order (first outermost), `enumeration` how the schedule visits the term space, `rounding` where the
// rounds happen (one rounded product and one rounded fold per term, as the meaning prescribes).
export interface FoldOrder {
  kernel: string;
  statement: string;
  /** The reduction's preorder index within the statement's expression. */
  reduction: number;
  op: 'sum' | 'max';
  axes: string[];
  /** 'ascending', or 'invalid: …' when the schedule's chunking is not an exact ascending partition of [0, K). */
  enumeration: string;
  rounding: 'per-term';
  /** How the schedule realizes the fold: serial loops, a term buffer (stage 3b), or contraction tiles. */
  via: 'serial' | 'terms' | 'tiles';
}
/** The order-relevant projection of a fold record: what a pass must keep (the realization `via` may change). */
const orderProjection = (f: FoldOrder) => {
  const { kernel, statement, reduction, op, axes, enumeration, rounding } = f;
  return { kernel, statement, reduction, op, axes, enumeration, rounding };
};

/** Whether `bk`-sized chunks `[k0*bk, min(K, (k0+1)*bk))`, k0 ascending, inner ascending, partition [0, K)
 * for every extent. The form is the one the emitter prints; the probe values cover empty, short, aligned,
 * unaligned and multiple-chunk extents, so a structural change (a reversed or gapped loop) fails. */
function ascendingChunks(bk: number): boolean {
  if (!Number.isInteger(bk) || bk <= 0) return false;
  for (const K of [0, 1, 2, bk - 1, bk, bk + 1, 2 * bk, 5 * bk + 7, 31]) {
    let next = 0;
    const chunks = Math.ceil(K / bk);
    for (let k0 = 0; k0 < chunks; ++k0) {
      const start = k0 * bk,
        len = Math.min(bk, K - start);
      if (start !== next || len <= 0) return false;
      next = start + len;
    }
    if (next !== K) return false;
  }
  return true;
}

/** The canonical fold-order signature of a schedule: what the emitter will do, per reduction. */
export function scheduleOrder(unit: ScheduleUnit): FoldOrder[] {
  const byName = new Map(unit.statements.map(s => [s.name, s]));
  const out: FoldOrder[] = [];
  for (const kernel of unit.kernels)
    for (const name of kernel.statements) {
      const statement = byName.get(name)!;
      const reductions = allReductions(statement.expr);
      // Stage 3b's term staging is keyed by outermost-reduction index (fusion.ts `outerReductions`).
      const outer = new Map(outerReductions(statement.expr).map((r, i) => [r, i] as const));
      reductions.forEach((r, i) => {
        const t = kernel.tile;
        // a tile schedule replaces exactly one reduction of one statement; it must fold that reduction's own
        // axis and operation, or the schedule is invalid regardless of anything else
        const isTiled = t !== undefined && t.statement === name && reductions.length === 1;
        const matches = isTiled && r.op === t.reduce.op && r.axes[0].id === t.reduce.axis;
        out.push({
          kernel: kernel.kernel,
          statement: name,
          reduction: i,
          op: r.op,
          axes: r.axes.map(a => a.id),
          enumeration: isTiled
            ? !matches
              ? 'invalid: the tiled fold does not match the reduction it replaces'
              : t.configs.every(c => ascendingChunks(c.bk))
                ? 'ascending'
                : 'invalid: the chunking does not cover the reduction extent as an ascending partition'
            : 'ascending',
          rounding: 'per-term',
          via: isTiled
            ? 'tiles'
            : kernel.terms.some(t2 => t2.statement === name && outer.get(r) === t2.reduction)
              ? 'terms'
              : 'serial',
        });
      });
    }
  return out;
}

export const ScheduleIR = defineIR<ScheduleUnit>({
  id: 'tensor.schedule',
  version: '1',
  description: 'The algorithm of a Tix function with the schedule each kernel runs',
  entities: unit => unit.kernels.map(k => k.kernel),
  validate(value) {
    const unit = value as Partial<ScheduleUnit> | null;
    // A function that returns a parameter has no statements and no kernels (stage 2: zero launches).
    requireSchedule(
      typeof unit?.fn === 'string' &&
        !!unit.fn &&
        Array.isArray(unit.statements) &&
        Array.isArray(unit.kernels) &&
        Array.isArray(unit.refusals),
      'Invalid schedule',
    );
    const names = new Set(unit.statements.map(s => (s as Statement).name));
    requireSchedule(names.size === unit.statements.length, 'Duplicate statement');
    for (const k of unit.kernels) validateKernel(unit as ScheduleUnit, k as ScheduleKernel);
  },
});

function* sirEntities(unit: ScheduleUnit): Generator<IREntity> {
  yield { id: unit.fn, kind: 'function', attributes: {} };
  for (const t of [...unit.params, ...unit.statements])
    yield { id: t.name, kind: 'tensor', attributes: { shape: t.shape } };
  for (const k of unit.kernels)
    yield {
      id: k.kernel,
      kind: 'kernel',
      attributes: { statements: k.statements, mapping: k.mapping, tile: k.tile ?? null },
    };
}
function* sirRelations(unit: ScheduleUnit): Generator<IRRelation> {
  let order = 0;
  for (const t of [...unit.params, ...unit.statements]) {
    yield {
      id: 'contains/' + t.name,
      from: unit.fn,
      to: t.name,
      kind: 'contains',
      category: 'containment',
      order: order++,
    };
  }
  for (const k of unit.kernels) {
    for (const name of k.statements) {
      yield {
        id: 'computes/' + k.kernel + '/' + name,
        from: k.kernel,
        to: name,
        kind: 'computes',
        category: 'containment',
        order: 0,
      };
    }
    const reads = new Set<string>();
    for (const name of k.statements)
      visit(unit.statements.find(s => s.name === name)!.expr, e => {
        if (e.kind === 'load') reads.add(e.name);
      });
    for (const name of reads)
      yield {
        id: 'reads/' + k.kernel + '/' + name,
        from: k.kernel,
        to: name,
        kind: 'reads',
        category: 'dependency',
        order: 0,
      };
  }
}
export const scheduleAdapter = defineAdapter<ScheduleUnit>({
  id: 'tensor.schedule-adapter',
  version: '1',
  description: 'Kernels, the statements they compute and the tensors they read',
  kind: ScheduleIR.id,
  schemaVersion: ScheduleIR.version,
  validate: value => ScheduleIR.validate(value),
  relationKinds: { contains: 'containment', computes: 'containment', reads: 'dependency' },
  entities: sirEntities,
  relations: sirRelations,
  resolve: (unit, id) => [...sirEntities(unit)].find(e => e.id === id),
  describe: (_, id) => ({ label: id }),
});

/** Fusion decisions feed the schedule from their plan: groups become kernels, with their constructs. */
export function buildSchedule(fn: Fn, fuse: boolean): ScheduleUnit {
  const plan = fuse ? planFusion(fn) : unfusedPlan(fn);
  return {
    fn: fn.name,
    statements: fn.statements,
    params: fn.params,
    kernels: plan.groups.map(g => ({ ...g })),
    refusals: [],
  };
}

// The property: every reduction of every member statement folds its terms lexicographic ascending over its own
// axes (first outermost), one rounded product and one rounded fold per term, exactly as the meaning prescribes.
// The analysis reads the schedule's constructs; the emitter must realize them, which the GPU differential
// checks. `effects: []` and no context use: the synchronous pass machinery recomputes it (define-pass.ts).
export const scheduleOrderAnalysis = defineAnalysis({
  id: 'tensor.schedule-order',
  version: '1',
  description: 'The fold order each schedule performs, per kernel member statement and reduction',
  input: ScheduleIR,
  output: JsonValue,
  effects: [],
  run: (_ctx, artifact): unknown => scheduleOrder(artifact.value).map(orderProjection),
});
const orderedCheck: AnalysisDefinition<ScheduleUnit, CheckResult> = defineAnalysis({
  id: 'tensor.schedule-order-check',
  version: '1',
  description: 'Every reduction folds its terms in the meaning order, one rounded term at a time',
  input: ScheduleIR,
  output: Check,
  effects: [],
  run(_ctx, artifact) {
    const unit = artifact.value;
    const folds = scheduleOrder(unit);
    // Completeness: one record per reduction of every member statement, with the algorithm's axes and op.
    const expected: string[] = [];
    for (const kernel of unit.kernels)
      for (const name of kernel.statements)
        allReductions(unit.statements.find(s => s.name === name)!.expr).forEach((r, i) =>
          expected.push(JSON.stringify([kernel.kernel, name, i, r.op, r.axes.map(a => a.id)])),
        );
    const got = folds.map(f => JSON.stringify([f.kernel, f.statement, f.reduction, f.op, f.axes]));
    const missing = expected.filter(e => !got.includes(e)),
      extra = got.filter(g => !expected.includes(g));
    if (missing.length || extra.length)
      return { ok: false, reason: `Fold inventory differs: ${[...missing, ...extra].join('; ')}` };
    for (const f of folds)
      if (f.enumeration !== 'ascending')
        return {
          ok: false,
          reason: `${f.kernel}/${f.statement} reduction ${f.reduction}: ${f.enumeration}`,
        };
    return { ok: true, reason: 'Every reduction folds ascending, one rounded term at a time' };
  },
});
export const ScheduleOrdered = defineProperty({
  id: 'tensor.schedule-ordered',
  version: '1',
  description: 'The schedule folds every reduction in the meaning order, one rounded term at a time',
  subject: ScheduleIR,
  check: orderedCheck,
});

// The gate every scheduling pass is applied under: the whole candidate schedule must still be meaning-ordered.
export const meaningOrdered = (
  _before: Artifact<ScheduleUnit>,
  candidate: Artifact<ScheduleUnit>,
): CheckResult => orderedCheck.run(undefined as never, candidate, undefined) as CheckResult;

type Load = Extract<Expr, { kind: 'load' }>;
/** Whether a kernel's single statement is a two-operand contraction the tile schedule covers. */
function tileLegality(
  unit: ScheduleUnit,
  kernel: ScheduleKernel,
): { ok: true; value: TileSchedule } | { ok: false; reason: string } {
  const refuse = (reason: string) => ({ ok: false as const, reason });
  const statement = unit.statements.find(s => s.name === kernel.statements[0])!;
  if (kernel.statements.length !== 1)
    return refuse(
      `the kernel computes ${kernel.statements.length} statements; tiling a fused group is a later stage`,
    );
  const reductions = allReductions(statement.expr);
  if (reductions.length === 0) return refuse('the statement has no reduction');
  if (reductions.length > 1) return refuse(`the statement has ${reductions.length} reductions`);
  const r = reductions[0];
  if (r.axes.length !== 1)
    return refuse(
      `the reduction runs over ${r.axes.length} axes (conv2d-style contractions are a later stage)`,
    );
  const axis = r.axes[0];
  if (axis.extent.kind !== 'dim')
    return refuse('the reduction extent is generated by split-sum; the chunking would not cover it');
  if (statement.axes.length !== 2)
    return refuse(`the output has rank ${statement.axes.length}; the register patch is two-dimensional`);
  if (r.body.kind !== 'op' || r.body.op !== '*') return refuse('the body is not a product of two loads');
  const args = (r.body as Extract<Expr, { kind: 'op' }>).args as Load[];
  if (args.length !== 2 || args.some(a => a.kind !== 'load'))
    return refuse('the body is not a product of two loads');
  const outs = statement.axes.map(a => a.id);
  const loads: TileOperand[] = [];
  for (const l of args as Load[]) {
    const indices = l.indices.map(plain);
    if (indices.some(i => i === undefined)) return refuse(`${l.name} is read at an affine index`);
    const ks = indices.filter(i => i === axis.id).length;
    if (ks !== 1) return refuse(`${l.name} does not read the reduction axis exactly once`);
    const distinct = [...new Set(indices.filter(i => i !== axis.id))];
    if (distinct.some(i => !outs.includes(i!)))
      return refuse(`${l.name} reads an index that is neither an output axis nor the reduction axis`);
    if (distinct.length > 1) return refuse(`${l.name} reads both output axes`);
    loads.push({
      tensor: l.name,
      indices: indices as string[],
      cls: distinct.length ? (distinct[0] === outs[0] ? 'i' : 'j') : 'k',
    });
  }
  return {
    ok: true,
    value: {
      statement: statement.name,
      reduce: { op: r.op, axis: axis.id },
      loads,
      configs: tile.configs,
      stage: true,
      unroll: true,
      double: false,
      dispatch: tile.dispatch,
    },
  };
}

export interface TileParams {
  configs: TileConfig[];
  dispatch: { waves: number; minWork: number };
}
/** `tensor.tile-contraction`: give every legal two-operand contraction kernel its tile schedule. */
export const tilePass: Pass<ScheduleUnit, {}, TileParams> = definePass<ScheduleUnit, {}, TileParams>({
  id: 'tensor.tile-contraction',
  version: '1',
  description: 'Schedule a two-operand contraction over output tiles and reduction chunks',
  ir: ScheduleIR,
  adapter: scheduleAdapter,
  writes: { entities: ['kernel'], relations: [] },
  preserves: [scheduleOrderAnalysis],
  run: ({ before, params }) => {
    const unit = before.value;
    const refusals = [...unit.refusals];
    const kernels = unit.kernels.map(kernel => {
      if (kernel.tile) return kernel;
      const legality = tileLegality(unit, kernel);
      if (!legality.ok) {
        refusals.push({
          kernel: kernel.kernel,
          statement: kernel.statements.join(','),
          reason: legality.reason,
        });
        return kernel;
      }
      const { configs, dispatch } = params;
      return {
        ...kernel,
        tile: { ...legality.value, configs, dispatch },
        reasons: [
          ...kernel.reasons,
          `${legality.value.statement} runs in ${configs.length} tile configurations ` +
            `(${configs.map(c => `${c.bm}x${c.bn}x${c.bk}, patch ${c.tm}x${c.tn}`).join('; ')}), chosen at launch; ` +
            'operand tiles are staged in shared memory and one thread folds a patch of outputs in the meaning order',
        ],
      };
    });
    return {
      native: { ...unit, kernels, refusals },
      edits: kernels.filter((k, i) => k !== unit.kernels[i]).length,
    };
  },
});

/** `tensor.double-buffer`: stage the next reduction chunk's tiles while the current one is folded. */
export const doubleBufferPass: Pass<ScheduleUnit> = definePass<ScheduleUnit>({
  id: 'tensor.double-buffer',
  version: '1',
  description: 'Stage the next chunk of the operand tiles while folding the current chunk',
  ir: ScheduleIR,
  adapter: scheduleAdapter,
  writes: { entities: ['kernel'], relations: [] },
  preserves: [scheduleOrderAnalysis],
  run: ({ before }) => {
    const unit = before.value;
    const refusals = [...unit.refusals];
    const kernels = unit.kernels.map(kernel => {
      const t = kernel.tile;
      if (!t || t.double) return kernel;
      if (!t.stage) {
        refusals.push({ kernel: kernel.kernel, statement: t.statement, reason: 'operands are not staged' });
        return kernel;
      }
      if (!t.configs.every(c => 2 * tileSharedBytes(c, t.loads) <= sharedOptIn)) {
        refusals.push({
          kernel: kernel.kernel,
          statement: t.statement,
          reason: 'two operand-tile sets do not fit in the opt-in shared-memory limit',
        });
        return kernel;
      }
      return {
        ...kernel,
        tile: { ...t, double: true },
        reasons: [
          ...kernel.reasons,
          `${t.statement} stages the next chunk's tiles while folding the current one`,
        ],
      };
    });
    return {
      native: { ...unit, kernels, refusals },
      edits: kernels.filter((k, i) => k !== unit.kernels[i]).length,
    };
  },
});

/** The rule that picks a schedule: which passes to run, with what constants, and why. Decided from the schedule
 * alone; the launch rule inside a tile schedule picks the configuration from the shapes. `src/framework/strategy`
 * does not fit here: its interpreter is asynchronous while `cudaSource` is a fixed synchronous API, its plans
 * are static JSON (so the per-program decision would be built by code before the plan exists), and its
 * algorithms exchange JSON values, not artifacts and manager contexts. The sequenced rule with recorded
// reasons is what that layer would orchestrate. */
export interface ScheduleStep {
  pass: Pass<ScheduleUnit, {}, unknown>;
  params?: unknown;
  reason: string;
}
export function scheduleStrategy(schedule: ScheduleUnit, options: { fuse: boolean }): ScheduleStep[] {
  if (!options.fuse) return []; // stage 2: one element-mapping kernel per statement, no scheduling
  const steps: ScheduleStep[] = [];
  if (schedule.kernels.some(k => !k.tile))
    steps.push({
      pass: tilePass as Pass<ScheduleUnit, {}, unknown>,
      params: { configs: tile.configs, dispatch: tile.dispatch },
      reason: 'tile every legal two-operand contraction',
    });
  if (tile.doubleBuffer && (schedule.kernels.some(k => k.tile) || steps.length))
    steps.push({
      pass: doubleBufferPass as Pass<ScheduleUnit, {}, unknown>,
      reason: 'overlap the next chunk of operand tiles with the fold',
    });
  return steps;
}

/** The lowering's compiler: fusion plan -> schedule artifact -> checked scheduling passes -> final schedule. */
export function lowerSchedule(fn: Fn, fuse: boolean): ScheduleUnit {
  const unit = buildSchedule(fn, fuse);
  let artifact = createIRArtifact(scheduleAdapter, 'tix-schedule/' + fn.name, unit);
  for (const step of scheduleStrategy(unit, { fuse })) {
    try {
      const result = applyNativePassSync(
        step.pass as Pass<ScheduleUnit, {}, unknown>,
        artifact,
        meaningOrdered,
        step.params,
      );
      if (result.changed) artifact = result.artifact;
    } catch (error) {
      // A step that cannot preserve the order keeps the previous revision, and the rejection is recorded in the
      // schedule's refusals; every program still lowers.
      if (
        error instanceof PassError &&
        (error.code === 'preserveViolated' || error.code === 'contractRejected')
      ) {
        const kept = artifact.value;
        artifact = createIRArtifact(scheduleAdapter, 'tix-schedule/' + kept.fn, {
          ...kept,
          refusals: [
            ...kept.refusals,
            { kernel: '*', statement: '', reason: `${step.pass.id} was rejected: ${error.message}` },
          ],
        });
        continue;
      }
      throw error;
    }
  }
  return artifact.value;
}
