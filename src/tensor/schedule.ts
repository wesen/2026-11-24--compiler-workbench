// IRWB-033-G: the schedule, a v6 artifact between Tix and the CUDA source.
//
// Until stage 6 every lowering decision lived in `planFusion`'s plan and in the emitter: nothing could look at one
// decision on its own. A schedule says, per kernel, which statements it computes, where their values live, how the
// threads are bound, and (for a contraction) how the outputs and the reduction are tiled. It is the input to the
// emitter, which prints it and decides nothing; scheduling passes (`schedule-passes.ts`) refine it; a strategy
// (`schedule-strategy.ts`) picks the steps. The fusion plan of stage 3 and 3b feeds it: `scheduleFromPlan` turns a
// verdict about which statements may share a kernel into kernels, and everything after that is a pass on one
// kernel.
import { defineIR } from '../framework/contracts/index.js';
import { defineAdapter, type IREntity, type IRRelation } from '../framework/ir/index.js';
import {
  outerReductions,
  type FusionGroup,
  type FusionPlan,
  type FusionRefusal,
  type Reduce,
} from './fusion.js';
import type { Affine, Expr, Fn, Statement, Tensor } from './model.js';

/** One level of a reduction's loop nest, as the emitted code will run it (see `orderClaim`). */
export interface OrderLevel {
  /** The reduction axis this level walks. */
  axis: string;
  /** `axis`: the reduction's own loop; `strip`: an outer loop of its strip-mine; `terms`: a fold over a term buffer. */
  kind: 'axis' | 'strip' | 'terms' | 'block';
  /** The reduction's extent, in shape names. */
  extent: Affine;
  /** `strip`: the width of one pass. */
  width?: number;
}
export interface ReductionOrder {
  statement: string;
  /** The statement's outermost reductions, numbered in preorder (`outerReductions`). */
  reduction: number;
  /** The loop nest, outside in. */
  nest: OrderLevel[];
}

export interface ContractionSchedule {
  statement: string;
  reduction: number;
  /** Outputs per block: rows, columns. */
  block: [number, number];
  /** Outputs per lane, its register patch: rows, columns. */
  lane: [number, number];
  /** Reduction terms per pass over the operands (the strip-mine width of the reduction loop). */
  kTile: number;
  /** The operands copied into shared tiles: `a` is read along the output rows, `b` along the columns. */
  stage: string[];
  /** One buffer, or two with a prefetch. */
  buffer: 'single' | 'double';
}

export interface ScheduleKernel {
  name: string;
  mapping: 'thread' | 'block';
  /** The number of leading axes the members share: the block domain. */
  depth: number;
  /** Tix statements this kernel computes, in order. */
  members: string[];
  stored: string[];
  buffered: string[];
  staged: string[];
  terms: { statement: string; reduction: number }[];
  inPlace: { statement: string; over: string }[];
  heavy: string[];
  gated: boolean;
  /**
   * Threads per block, as a rule over the shapes with a cap: `rows` covers the longest row, `contraction` caps at a
   * narrower number because a reduction streams its operands out of cache, `heavy` follows the narrowest heavy row.
   * The rule is the schedule; the emitter prints the C++ that computes it.
   */
  threads: { rule: 'rows' | 'contraction' | 'heavy'; cap: number };
  /** Present only for a tiled contraction. */
  contraction?: ContractionSchedule;
  /** The visit order of each outermost reduction of each member (what `tensor.accumulation-order` reads). */
  orders: ReductionOrder[];
  /** Why this kernel looks the way it does, in order: the plan's reasons and then the passes'. */
  reasons: string[];
}

export interface ScheduleFunction {
  fn: string;
  /** The Tix artifact this schedule is of. */
  source: { artifact: string; revision: string };
  kernels: ScheduleKernel[];
  refusals: FusionRefusal[];
  termRefusals: FusionRefusal[];
}

function requireSchedule(condition: unknown, reason: string): asserts condition {
  if (!condition) throw Error('Invalid schedule: ' + reason);
}
const text = (a: Affine) =>
  [
    ...a.terms.map(([n, k]) => (k === 1 ? n : `${k}*${n}`)),
    ...(a.constant || !a.terms.length ? [a.constant] : []),
  ].join(' + ');
const isAffine = (a: unknown) =>
  !!a &&
  typeof a === 'object' &&
  Number.isSafeInteger((a as Affine).constant) &&
  Array.isArray((a as Affine).terms) &&
  (a as Affine).terms.every(([n, k]) => typeof n === 'string' && !!n && Number.isSafeInteger(k) && k !== 0);
const whole = (n: unknown, atLeast = 1) =>
  Number.isInteger(n) && (n as number) >= atLeast && (n as number) <= 1024;

function validate(value: unknown) {
  const s = value as Partial<ScheduleFunction> | null;
  requireSchedule(typeof s?.fn === 'string' && !!s.fn, 'a function name');
  requireSchedule(
    !!s.source && typeof s.source.artifact === 'string' && typeof s.source.revision === 'string',
    'the source artifact it schedules',
  );
  requireSchedule(
    Array.isArray(s.kernels) && Array.isArray(s.refusals) && Array.isArray(s.termRefusals),
    'kernels',
  );
  requireSchedule(
    new Set(s.kernels!.map(k => k?.name)).size === s.kernels!.length,
    'a kernel name per kernel, distinct',
  );
  const members = new Set<string>();
  for (const k of s.kernels!) {
    requireSchedule(typeof k?.name === 'string' && /^k\d+$/.test(k.name), `kernel name ${String(k?.name)}`);
    requireSchedule(['thread', 'block'].includes(k.mapping), `${k.name}: a mapping`);
    requireSchedule(whole(k.depth, 0), `${k.name}: the block depth`);
    requireSchedule(
      Array.isArray(k.members) && k.members.length && k.members.every(m => typeof m === 'string' && !!m),
      `${k.name}: members`,
    );
    for (const m of k.members) {
      requireSchedule(!members.has(m), `${k.name}: ${m} is in two kernels`);
      members.add(m);
    }
    for (const field of ['stored', 'buffered', 'staged', 'heavy'] as const)
      requireSchedule(
        Array.isArray(k[field]) &&
          (k[field] as string[]).every(
            m => typeof m === 'string' && (field === 'staged' || k.members.includes(m)),
          ),
        `${k.name}: ${field}`,
      );
    requireSchedule(Array.isArray(k.terms) && Array.isArray(k.inPlace), `${k.name}: terms and inPlace`);
    requireSchedule(typeof k.gated === 'boolean', `${k.name}: gated`);
    requireSchedule(
      !!k.threads && ['rows', 'contraction', 'heavy'].includes(k.threads.rule) && whole(k.threads.cap, 32),
      `${k.name}: threads`,
    );
    requireSchedule(
      Array.isArray(k.reasons) && k.reasons.every(r => typeof r === 'string'),
      `${k.name}: reasons`,
    );
    requireSchedule(Array.isArray(k.orders), `${k.name}: orders`);
    for (const o of k.orders) {
      requireSchedule(k.members.includes(o?.statement), `${k.name}: order of a member`);
      requireSchedule(Number.isInteger(o.reduction) && o.reduction >= 0, `${k.name}: order reduction`);
      requireSchedule(
        Array.isArray(o.nest) &&
          o.nest.length &&
          o.nest.every(
            l =>
              typeof l?.axis === 'string' &&
              ['axis', 'strip', 'terms', 'block'].includes(l.kind) &&
              isAffine(l.extent) &&
              (l.kind !== 'strip' || whole(l.width, 2)),
          ),
        `${k.name}: order nest`,
      );
    }
    if (k.contraction !== undefined) {
      const c = k.contraction;
      requireSchedule(
        k.mapping === 'thread' && k.members.length === 1,
        `${k.name}: a tiled contraction is alone`,
      );
      requireSchedule(c.statement === k.members[0], `${k.name}: the contraction's statement`);
      requireSchedule(whole(c.reduction, 0), `${k.name}: the contraction's reduction`);
      requireSchedule(
        Array.isArray(c.block) &&
          c.block.length === 2 &&
          c.block.every(n => whole(n, 1) && n <= 512) &&
          Array.isArray(c.lane) &&
          c.lane.length === 2 &&
          c.lane.every(n => whole(n, 1) && n <= 32),
        `${k.name}: block and lane tiles`,
      );
      requireSchedule(whole(c.kTile, 1), `${k.name}: kTile`);
      requireSchedule(
        Array.isArray(c.stage) && c.stage.every(s => s === 'a' || s === 'b'),
        `${k.name}: stage`,
      );
      requireSchedule(['single', 'double'].includes(c.buffer), `${k.name}: buffer`);
    }
  }
}

export const ScheduleIR = defineIR<ScheduleFunction>({
  id: 'tensor.schedule',
  version: '1',
  description:
    'Kernels of a Tix function: members, where their values live, thread binding and contraction tiling',
  validate,
  entities: s => s.kernels.map(k => k.name),
});

function* entities(s: ScheduleFunction): Generator<IREntity> {
  for (const k of s.kernels) {
    yield { id: k.name, kind: 'kernel', attributes: { mapping: k.mapping, members: k.members } };
    for (const m of k.members)
      yield {
        id: s.fn + '/' + m,
        kind: 'member',
        attributes: { kernel: k.name, stored: k.stored.includes(m) },
      };
  }
}
function* relations(s: ScheduleFunction): Generator<IRRelation> {
  for (const k of s.kernels)
    for (const [order, m] of k.members.entries())
      yield {
        id: `contains/${k.name}/${m}`,
        from: k.name,
        to: s.fn + '/' + m,
        kind: 'contains',
        category: 'containment',
        order,
      };
}

export const scheduleAdapter = defineAdapter<ScheduleFunction>({
  id: 'tensor.schedule-adapter',
  version: '1',
  description: 'Kernels, the members they compute and how each is scheduled',
  kind: ScheduleIR.id,
  schemaVersion: ScheduleIR.version,
  validate,
  relationKinds: { contains: 'containment' },
  entities,
  relations,
  resolve: (s, id) => [...entities(s)].find(e => e.id === id),
  describe: (_, id) => ({ label: id }),
});

/** Threads per block in block mode: measured caps (IRWB-029-D diary step 4, IRWB-030-E scripts 06 and 09). */
export const blockThreads = { rows: 128, contraction: 64, heavy: 256 };

// Whether a member's expression reads a tensor that is not in a row buffer from inside a reduction: a contraction
// streams its operands out of cache, and one thread per element of the row then wants a narrower block.
function streamsOperand(members: Statement[], rowBuffers: readonly string[]): boolean {
  const operands = (e: Expr, inReduction: boolean): boolean =>
    e.kind === 'load'
      ? inReduction && !rowBuffers.includes(e.name)
      : e.kind === 'op'
        ? e.args.some(a => operands(a, inReduction))
        : e.kind === 'reduce' && operands(e.body, true);
  return members.some(m => operands(m.expr, false));
}

/** The visit order the fusion plan's mapping gives a member's outermost reductions (fusion.ts, stage 3b). */
export function plannedOrders(
  kernel: {
    members: string[];
    terms: { statement: string; reduction: number }[];
  },
  statements: ReadonlyMap<string, Statement>,
): ReductionOrder[] {
  const orders: ReductionOrder[] = [];
  for (const name of kernel.members) {
    const statement = statements.get(name);
    if (!statement) continue;
    outerReductions(statement.expr).forEach((r, reduction) => {
      const staged = kernel.terms.some(t => t.statement === name && t.reduction === reduction);
      orders.push({
        statement: name,
        reduction,
        nest: r.axes.map(({ id, extent }) => ({
          axis: id,
          kind: staged ? ('terms' as const) : ('axis' as const),
          extent: extent.dim,
        })),
      });
    });
  }
  return orders;
}

/** The schedule the fusion plan describes: the kernels stage 3 and 3b decided, with no tiling. */
export function scheduleFromPlan(
  fn: Fn,
  plan: FusionPlan,
  source: { artifact: string; revision: string } = { artifact: 'tix', revision: '' },
): ScheduleFunction {
  const statements = new Map<string, Statement>(fn.statements.map(s => [s.name, s]));
  return {
    fn: fn.name,
    source,
    refusals: plan.refusals.map(r => ({ ...r })),
    termRefusals: plan.termRefusals.map(r => ({ ...r })),
    kernels: plan.groups.map((g: FusionGroup): ScheduleKernel => {
      const members = g.statements.map(n => statements.get(n) as Statement);
      const rowBuffers = [...g.staged, ...g.buffered];
      const rule = g.heavy.length ? 'heavy' : streamsOperand(members, rowBuffers) ? 'contraction' : 'rows';
      const kernel: ScheduleKernel = {
        name: g.kernel,
        mapping: g.mapping,
        depth: g.depth,
        members: g.statements,
        stored: [...g.stored],
        buffered: [...g.buffered],
        staged: [...g.staged],
        terms: g.terms.map(t => ({ ...t })),
        inPlace: g.inPlace.map(p => ({ ...p })),
        heavy: [...g.heavy],
        gated: g.gated,
        threads: { rule, cap: blockThreads[rule] },
        orders: [],
        reasons: [...g.reasons],
      };
      kernel.orders = plannedOrders(kernel, statements);
      return kernel;
    }),
  };
}

// The contraction a kernel can be tiled as, decided from the Tix IR and the kernel's mapping: exactly one member,
// mapped thread-per-element, rank 2, one outermost reduction over one axis, whose body multiplies two tensor reads;
// one read walks the output rows (index 0 is the member's own row axis, index 1 the reduction axis), the other the
// columns (index 0 the reduction axis, index 1 the member's own column axis). Both may be shifted by a constant.
export interface ContractionTiling {
  statement: Statement;
  reduction: Reduce;
  axis: string;
  extent: Affine;
  /** The operand read along the output rows, and the one read along the columns. */
  rows: Extract<Expr, { kind: 'load' }>;
  columns: Extract<Expr, { kind: 'load' }>;
  /** Whether each operand's reduction index is its last index, so a tile copy walks memory in order. */
  rowsKLast: boolean;
  columnsKLast: boolean;
  tensors: ReadonlyMap<string, Tensor>;
}
export function contractionOf(
  kernel: ScheduleKernel,
  fn: Fn,
): { ok: true; tiling: ContractionTiling } | { ok: false; reason: string } {
  const refuse = (reason: string) => ({ ok: false as const, reason: `${kernel.name}: ${reason}` });
  if (kernel.mapping !== 'thread') return refuse('it runs in block mode');
  if (kernel.members.length !== 1) return refuse(`it computes ${kernel.members.length} statements`);
  const statement = fn.statements.find(s => s.name === kernel.members[0]);
  if (!statement) return refuse('its statement is not in the function');
  if (statement.axes.length !== 2) return refuse(`its output has ${statement.axes.length} axes, not 2`);
  const outer = outerReductions(statement.expr);
  if (outer.length !== 1) return refuse(`it has ${outer.length} outermost reductions, not 1`);
  const reduction = outer[0];
  if (reduction.op !== 'sum') return refuse('its reduction is a max');
  if (reduction.axes.length !== 1)
    return refuse(`its reduction is over ${reduction.axes.length} axes, not 1`);
  const body = reduction.body;
  if (body.kind !== 'op' || body.op !== '*' || body.args.length !== 2)
    return refuse("the reduction's body is not a product of two factors");
  const factors = body.args.filter((e): e is Extract<Expr, { kind: 'load' }> => e.kind === 'load');
  if (factors.length !== 2) return refuse("the reduction's body does not multiply two tensor reads");
  const [rowAxis, columnAxis] = statement.axes.map(a => a.id);
  const k = reduction.axes[0].id;
  // An index is "the axis itself, plus a constant" when it is affine with that axis at coefficient 1 and no others.
  const own = (a: Affine, axis: string) =>
    a.terms.length === 1 && a.terms[0][0] === axis && a.terms[0][1] === 1;
  // An operand is read along the rows when one index is the member's row axis and the other the reduction axis,
  // and along the columns when one index is the column axis and the other the reduction axis — in either position,
  // so a[i,k], a[k,i], b[k,j] and b[j,k] all qualify.
  const walks = (f: Extract<Expr, { kind: 'load' }>, output: string) =>
    f.indices.length === 2 &&
    ((own(f.indices[0], output) && own(f.indices[1], k)) ||
      (own(f.indices[0], k) && own(f.indices[1], output)));
  const rows = factors.find(f => walks(f, rowAxis));
  const columns = factors.find(f => walks(f, columnAxis));
  if (!rows || !columns || rows === columns)
    return refuse('its two reads do not walk the output rows and columns against the reduction axis');
  const tensors = new Map<string, Tensor>([...fn.params, ...fn.statements].map(t => [t.name, t]));
  return {
    ok: true,
    tiling: {
      statement,
      reduction,
      axis: k,
      extent: reduction.axes[0].extent.dim,
      rows,
      columns,
      rowsKLast: own(rows.indices[1], k),
      columnsKLast: own(columns.indices[1], k),
      tensors,
    },
  };
}

/** The order of a reduction's nest, flattened as far as the nest really is the meaning's sequence (see orderClaim). */
export function flattenOrder(nest: readonly OrderLevel[]): string[] {
  const flat: string[] = [];
  for (let i = 0; i < nest.length; ++i) {
    const level = nest[i],
      next = nest[i + 1];
    // The meaning's sequence: one increasing pass over the axis, whatever the nest that produces it — the axis's own
    // loop, a fold over a term buffer in the same order, or a strip-mine whose inner level climbs from its outer one.
    if (level.kind === 'terms' || level.kind === 'axis') {
      flat.push(`${level.axis} 0..${text(level.extent)} step 1`);
      continue;
    }
    if (level.kind === 'strip' && next && next.kind === 'axis' && next.axis === level.axis) {
      flat.push(`${level.axis} 0..${text(level.extent)} step 1`);
      ++i;
      continue;
    }
    // Anything else is a nest that does not walk the axis once in increasing order: a parallel or reversed level.
    flat.push(`${level.kind}:${level.axis} 0..${text(level.extent)} step 1`);
  }
  return flat;
}

/**
 * The accumulation order of every outermost reduction of every member: each output element visits these indices,
 * in this order, one at a time. Two schedules with the same claim visit every output's terms alike, so a scheduling
 * pass that keeps it cannot change a single result bit of an f32 sum (argued; the GPU check covers the rest).
 */
export function orderClaim(schedule: ScheduleFunction): string[] {
  const claims: string[] = [];
  for (const kernel of schedule.kernels)
    for (const order of [...kernel.orders].sort(
      (a, b) => a.statement.localeCompare(b.statement) || a.reduction - b.reduction,
    ))
      claims.push(
        `${kernel.name} ${order.statement} ${order.reduction}: ${flattenOrder(order.nest).join(' > ')}`,
      );
  return claims.sort();
}

/** Why `next` may replace `before`: the claims must be equal, else the pass reordered a reduction. */
export function orderViolation(before: ScheduleFunction, next: ScheduleFunction): string | undefined {
  const a = orderClaim(before),
    b = orderClaim(next);
  const at = a.findIndex((c, i) => c !== b[i]);
  if (at < 0 && a.length === b.length) return undefined;
  const first = a[at] ?? b[at] ?? '';
  const other = b.find(c => !a.includes(c)) ?? a.find(c => !b.includes(c)) ?? (at >= 0 ? b[at] : '');
  return `the accumulation order changed: ${first} became ${other}`;
}
