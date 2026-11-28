// IRWB-033-D: the schedule IR, a v6 artifact between Tix and CUDA (design-doc/01 in the ticket).
//
// A schedule holds the algorithm (the Tix function, unchanged) and one schedule kernel per CUDA kernel:
//   - pointwise: one thread per element, members in registers (stage 2's kernels and stage 3's thread mode);
//   - rows: stage 3/3b block mode, its FusionGroup unchanged (staged terms, in-place rows, the gate);
//   - contraction: a pointwise group whose one reduction is a tileable contraction, with variants. Each variant is a
//     loop nest over four flattened dims (b: batch, m and n: the output axes only one operand reads, r: the
//     reduction axes in the meaning's order) and the operand tiles it stages in shared memory. The host picks a
//     variant at launch (`select`).
// IRWB-057: a schedule starts as stage 2's one kernel per statement and is changed by two transformations, each
// taking a plan as its parameter (K6, below): `fusePass` (the grouping) and `loopsPass` (the loop nests).
import { defineIR, type CheckResult } from '../framework/contracts/index.js';
import {
  defineAdapter,
  type CorrespondenceEntry,
  type IREntity,
  type IRRelation,
} from '../framework/ir/index.js';
import { transformation } from '../framework/passes/index.js';
import { createIRArtifact } from '../framework/ir/index.js';
import { canonical } from '../framework/core/data.js';
import type { Artifact } from '../framework/core/types.js';
import { distanceVector } from '../stdlib/affine/distances.js';
import { direction, orderViolation, stripMine, type Direction } from '../stdlib/affine/directions.js';
import {
  fusionEligible,
  fusionPlan,
  outerReductions,
  unfusedPlan,
  type FusionChoice,
  type FusionGroup,
  type FusionPlan,
  type Reduce,
} from './fusion.js';
import { add, constant, variable, visit, type Expr, type Fn, type Statement } from './model.js';

export type Dim = 'b' | 'm' | 'n' | 'r';
export const dimsInOrder: readonly Dim[] = ['b', 'm', 'n', 'r'];
export type Bind =
  | 'serial'
  | 'thread'
  | 'block.x'
  | 'block.y'
  | 'block.z'
  | 'thread.x'
  | 'thread.y'
  | 'unroll';
const binds: readonly Bind[] = [
  'serial',
  'thread',
  'block.x',
  'block.y',
  'block.z',
  'thread.x',
  'thread.y',
  'unroll',
];
export interface Loop {
  /** `<dim>.<level>`; level 0 is the outermost part of the dim. */
  id: string;
  dim: Dim;
  level: number;
  /** Iterations; null (level 0 only) is the rest, the dim's extent ceil-divided by the inner levels' product. */
  factor: number | null;
  bind: Bind;
}
export interface Stage {
  /** The operand whose tile is copied: the one that varies with m, or with n. */
  operand: 'm' | 'n';
  /** The loop at whose every iteration the tile is copied (an r loop). */
  at: string;
  scope: 'shared';
  /** The dim whose consecutive elements are adjacent in global memory; consecutive threads copy along it. */
  fast: Dim;
}
export interface Variant {
  loops: Loop[];
  stages: Stage[];
}
export interface ContractionKernel {
  name: string;
  kind: 'contraction';
  group: FusionGroup;
  /** The member whose reduction is the contraction. */
  contraction: string;
  /** Axis ids per dim, each flattened row-major in this order (r in the reduction's order: the meaning's). */
  dims: Record<Dim, string[]>;
  /** The tensors of the body `X * Y`: X varies with m, Y with n. */
  operands: { m: string; n: string };
  variants: Variant[];
  /**
   * At launch, the first entry whose grid has at least minBlocks per SM, and whose reduction has at least minTerms
   * terms, wins; the last entry has neither bound.
   */
  select: Selection[];
}
export interface Selection {
  variant: number;
  minBlocks: number;
  minTerms?: number;
}
export type ScheduleKernel =
  | { name: string; kind: 'pointwise'; group: FusionGroup }
  | { name: string; kind: 'rows'; group: FusionGroup }
  | ContractionKernel;
export interface Schedule {
  fn: Fn;
  kernels: ScheduleKernel[];
}

type Load = Extract<Expr, { kind: 'load' }>;
function reductions(e: Expr): Reduce[] {
  const out: Reduce[] = [];
  visit(e, x => {
    if (x.kind === 'reduce') out.push(x);
  });
  return out;
}
const loadsOf = (e: Expr) => {
  const out: Load[] = [];
  visit(e, x => {
    if (x.kind === 'load') out.push(x);
  });
  return out;
};

/** The contraction form of s, or why it has none (the design's "tileable contraction"). */
export function contractionForm(
  s: Statement,
  members: ReadonlySet<string> = new Set([s.name]),
): { dims: Record<Dim, string[]>; operands: { m: string; n: string }; reduce: Reduce } | string {
  const all = reductions(s.expr),
    outer = outerReductions(s.expr);
  if (all.length !== 1 || outer.length !== 1) return 'it does not have exactly one reduction';
  const [r] = outer;
  if (r.op !== 'sum') return 'its reduction is a max';
  if (r.axes.some(a => a.extent.kind !== 'dim')) return 'a reduction extent is not a dimension (split-sum)';
  const body = r.body;
  if (body.kind !== 'op' || body.op !== '*' || body.args.some(a => a.kind !== 'load'))
    return 'the reduction body is not a product of two loads';
  const [x, y] = body.args as Load[];
  if (members.has(x.name) || members.has(y.name)) return 'an operand is computed in the same kernel';
  const uses = (l: Load) => new Set(l.indices.flatMap(a => a.terms.map(([n]) => n)));
  const ux = uses(x),
    uy = uses(y);
  const out = s.axes.map(a => a.id);
  const m = out.filter(a => ux.has(a) && !uy.has(a)),
    n = out.filter(a => uy.has(a) && !ux.has(a));
  if (!m.length || !n.length) return 'no output axis is read by one operand only, so a tile has no reuse';
  return {
    dims: { b: out.filter(a => !m.includes(a) && !n.includes(a)), m, n, r: r.axes.map(a => a.id) },
    operands: { m: x.name, n: y.name },
    reduce: r,
  };
}

// ---- validation, entities, adapter ----

function require(condition: unknown, reason: string): asserts condition {
  if (!condition) throw Error(reason);
}
function validateVariant(v: Variant) {
  require(Array.isArray(v.loops) && Array.isArray(v.stages), 'Invalid schedule variant');
  const ids = new Set(v.loops.map(l => l.id));
  require(ids.size === v.loops.length, 'Duplicate loop id');
  for (const d of dimsInOrder) {
    const levels = v.loops.filter(l => l.dim === d).sort((a, b) => a.level - b.level);
    require(levels.length, `No loop over dim ${d}`);
    levels.forEach((l, i) => {
      require(l.level === i && l.id === `${d}.${i}`, 'Invalid loop levels');
      require(i === 0
        ? l.factor === null || (Number.isSafeInteger(l.factor) && l.factor > 0)
        : Number.isSafeInteger(l.factor) && l.factor! > 0, 'Invalid loop factor');
      require(binds.includes(l.bind), 'Invalid loop binding');
    });
  }
  for (const s of v.stages)
    require(['m', 'n'].includes(s.operand) &&
      ids.has(s.at) &&
      s.scope === 'shared' &&
      dimsInOrder.includes(s.fast), 'Invalid stage');
}
function validate(value: unknown) {
  const s = value as Schedule;
  require(s && typeof s.fn?.name === 'string' && Array.isArray(s.kernels), 'Invalid schedule');
  require(new Set(s.kernels.map(k => k.name)).size === s.kernels.length, 'Duplicate kernel name');
  const statements = new Set(s.fn.statements.map(t => t.name));
  const covered = s.kernels.flatMap(k => k.group.statements);
  require(covered.length === statements.size &&
    covered.every(n => statements.has(n)), 'Kernels must cover every statement once');
  for (const k of s.kernels) {
    require(['pointwise', 'rows', 'contraction'].includes(k.kind), 'Invalid kernel kind');
    if (k.kind !== 'contraction') continue;
    require(k.group.statements.includes(k.contraction), 'Contraction outside its kernel');
    require(k.variants.length > 0, 'A contraction kernel needs a variant');
    k.variants.forEach(validateVariant);
    require(k.select.length > 0 &&
      k.select.every(
        e => Number.isSafeInteger(e.variant) && e.variant >= 0 && e.variant < k.variants.length,
      ) &&
      k.select.at(-1)!.minBlocks === 0 &&
      !k.select.at(-1)!.minTerms, 'Invalid variant selection');
  }
}
function* entities(s: Schedule): Generator<IREntity> {
  for (const k of s.kernels) {
    const { name, kind, group } = k;
    const attributes: Record<string, unknown> = { kind, group };
    if (k.kind === 'contraction')
      Object.assign(attributes, {
        contraction: k.contraction,
        dims: k.dims,
        operands: k.operands,
        select: k.select,
      });
    yield { id: name, kind: 'kernel', attributes };
    if (k.kind !== 'contraction') continue;
    for (const [v, variant] of k.variants.entries()) {
      yield { id: `${name}/v${v}`, kind: 'variant', attributes: { order: variant.loops.map(l => l.id) } };
      for (const l of variant.loops)
        yield { id: `${name}/v${v}/${l.id}`, kind: 'loop', attributes: { ...l } };
      for (const st of variant.stages)
        yield { id: `${name}/v${v}/stage.${st.operand}`, kind: 'stage', attributes: { ...st } };
    }
  }
}
function* relations(s: Schedule): Generator<IRRelation> {
  for (const k of s.kernels) {
    if (k.kind !== 'contraction') continue;
    for (const [v, variant] of k.variants.entries()) {
      const id = `${k.name}/v${v}`;
      yield { id: 'contains/' + id, from: k.name, to: id, kind: 'contains', category: 'containment' };
      for (const l of variant.loops)
        yield {
          id: `contains/${id}/${l.id}`,
          from: id,
          to: `${id}/${l.id}`,
          kind: 'contains',
          category: 'containment',
        };
      for (const st of variant.stages)
        yield {
          id: `contains/${id}/stage.${st.operand}`,
          from: id,
          to: `${id}/stage.${st.operand}`,
          kind: 'contains',
          category: 'containment',
        };
    }
  }
}
const index = new WeakMap<Schedule, Map<string, IREntity>>();
function byId(s: Schedule) {
  let m = index.get(s);
  if (!m) index.set(s, (m = new Map([...entities(s)].map(e => [e.id, e]))));
  return m;
}
export const ScheduleIR = defineIR<Schedule>({
  id: 'tensor.schedule',
  version: '1',
  description:
    'A Tix function and the schedule of its kernels: fused groups and tiled contraction loop nests',
  validate,
  entities: s => [...entities(s)].map(e => e.id),
});
export const scheduleAdapter = defineAdapter<Schedule>({
  id: 'tensor.schedule.adapter',
  version: '1',
  description: 'Kernels, contraction variants, their loops and staged tiles',
  kind: ScheduleIR.id,
  schemaVersion: ScheduleIR.version,
  validate,
  relationKinds: { contains: 'containment' },
  entities,
  relations,
  resolve: (s, id) => byId(s).get(id),
  describe: (_, id) => ({ label: id }),
});

// ---- plans (IRWB-057, K6) ----
//
// A transformation that makes a choice takes the choice as its parameter, a plan: a serializable value that an
// untrusted `decide` (strategy.ts) computes. `eligible` decides whether the plan is legal on the schedule, `prepare`
// applies it, and one `ensures` check confirms that the candidate is the plan (`conforms`). So `decide` and
// `prepare` need not be trusted: a plan that `eligible` accepts and the candidate realizes is legal whoever made it.
// Fusion and loop scheduling are the two instances; both have the signature `(schedule, plan) => CheckResult`.

const ok: CheckResult = { ok: true };
const no = (reason: string): CheckResult => ({ ok: false, reason });
type Native = { native: Schedule; correspondence?: CorrespondenceEntry[] };
function planPass<P>(spec: {
  name: string;
  description: string;
  eligible: (s: Schedule, plan: P) => CheckResult;
  prepare: (s: Schedule, plan: P) => Native;
  /** Whether the candidate schedule is what the plan says. */
  conforms: (candidate: Schedule, plan: P, before: Schedule) => CheckResult;
}) {
  return transformation<Schedule, {}, P>({
    id: 'tensor.schedule.' + spec.name,
    version: '1',
    description: spec.description,
    ir: ScheduleIR,
    adapter: scheduleAdapter,
    writes: { entities: ['kernel', 'variant', 'loop', 'stage'], relations: ['contains'] },
    relation: 'exact',
    eligible: ({ before, params }) => spec.eligible(before.value, params),
    prepare: ({ before, params }) => spec.prepare(before.value, params),
    obligations: {
      ensures: [
        {
          id: 'tensor.schedule.conforms',
          check: ({ before, candidate, params }) => spec.conforms(candidate.value, params, before.value),
        },
      ],
    },
  });
}

/** Schedule kernels for a fusion plan: block-mode groups are rows kernels, the others pointwise. */
export function scheduleKernels(plan: FusionPlan): ScheduleKernel[] {
  return plan.groups.map(group => ({
    name: group.kernel,
    kind: group.mapping === 'block' ? 'rows' : 'pointwise',
    group,
  }));
}
/** The unscheduled function: stage 2's one pointwise kernel per statement. */
export function initialSchedule(fn: Fn): Artifact<Schedule> {
  return createIRArtifact(scheduleAdapter, 'tix-schedule/' + fn.name, {
    fn,
    kernels: scheduleKernels(unfusedPlan(fn)),
  });
}

/** Correspondence of a regrouping: the runs of old and new kernels that compute the same statements. */
function regrouped(
  before: readonly ScheduleKernel[],
  after: readonly ScheduleKernel[],
): CorrespondenceEntry[] {
  const entries: CorrespondenceEntry[] = [];
  let from: string[] = [],
    to: string[] = [];
  // both lists hold the statements in source order; a and b count the statements taken from each
  for (let i = 0, j = 0, a = 0, b = 0; i < before.length || j < after.length; ) {
    if (a <= b && i < before.length) {
      from.push(before[i].name);
      a += before[i++].group.statements.length;
    } else {
      to.push(after[j].name);
      b += after[j++].group.statements.length;
    }
    if (a !== b) continue;
    const relation =
      from.length === 1 && to.length === 1 ? 'retained' : to.length === 1 ? 'fused' : 'regrouped';
    entries.push({ from, to, relation });
    [from, to] = [[], []];
  }
  return entries;
}

/**
 * Fusion: the plan is the grouping (`FusionChoice`), legal by `fusionEligible` (zero dependence distance in each
 * kernel's block domain). It applies before any loop scheduling.
 */
export const fusePass = planPass<FusionChoice>({
  name: 'fuse',
  description: 'Group the statements into kernels as the plan says',
  eligible: (s, plan) =>
    s.kernels.some(k => k.kind === 'contraction')
      ? no('a contraction kernel is already scheduled')
      : fusionEligible(s.fn, plan),
  prepare: (s, plan) => {
    const kernels = scheduleKernels(fusionPlan(s.fn, plan));
    return { native: { fn: s.fn, kernels }, correspondence: regrouped(s.kernels, kernels) };
  },
  conforms: (candidate, plan) =>
    canonical(candidate.kernels.map(k => [k.kind !== 'contraction', k.group.statements, k.group.depth])) ===
    canonical(plan.groups.map(g => [true, g.statements, g.depth]))
      ? ok
      : no('the kernels are not the groups of the plan'),
});

/** The loop nests of a kernel's variants and its launch rule. */
export interface KernelLoops {
  kernel: string;
  variants: Variant[];
  select: Selection[];
}
/** The loop-scheduling plan: for each kernel it names, the order, tiling and bindings of every variant. */
export interface LoopPlan {
  kernels: KernelLoops[];
}

/** The member of a pointwise kernel whose reduction is a tileable contraction, with its form, or why there is none. */
export function contractionOf(s: Schedule, kernel: string) {
  const k = s.kernels.find(x => x.name === kernel);
  if (k?.kind !== 'pointwise') return `${kernel} is not a pointwise kernel`;
  const members = k.group.statements.map(n => s.fn.statements.find(t => t.name === n)!);
  const reducing = members.filter(m => reductions(m.expr).length);
  if (reducing.length !== 1) return `${kernel} has ${reducing.length} members with a reduction, not one`;
  const form = contractionForm(reducing[0], new Set(k.group.statements));
  return typeof form === 'string' ? `${reducing[0].name}: ${form}` : { statement: reducing[0].name, form, k };
}

const parallel = (b: Bind) => b !== 'serial' && b !== 'unroll';
/**
 * The contraction's dependence over its dims (b, m, n, r): term r of an output's sum adds to the accumulator that
 * term r - 1 left, so the statement at (b, m, n, r) reads its own result at (b, m, n, r - 1). Its distance vector
 * is (0, 0, 0, 1). The f32 sum is the source's only when every schedule keeps this dependence forward: an output
 * receives its terms in the order r = 0, 1, ...
 */
const accumulation: Direction[] = distanceVector(
  dimsInOrder,
  dimsInOrder.map(d => add(variable(d), constant(d === 'r' ? 1 : 0), -1)),
).map(direction);

/**
 * Why a variant's nest does not keep every output's accumulation order, or undefined. Each dim is strip-mined into
 * its levels (level 0 outermost; `stripMine` gives the directions of each level), and the nest must keep the
 * dependence forward with no two dependent iterations in parallel (`orderViolation` of the affine library). The
 * argument holds for every extent and every factor, so nothing is simulated.
 */
export function accumulationViolation(v: Variant): string | undefined {
  let vectors: Direction[][] = [accumulation];
  const offset = {} as Record<Dim, number>;
  for (const d of [...dimsInOrder].reverse()) {
    const levels = v.loops.filter(l => l.dim === d).length;
    for (let i = 1; i < levels; i++) vectors = stripMine(vectors, dimsInOrder.indexOf(d));
  }
  let next = 0;
  for (const d of dimsInOrder) {
    offset[d] = next;
    next += v.loops.filter(l => l.dim === d).length;
  }
  const position = (l: Loop) => offset[l.dim] + l.level;
  const found = orderViolation(
    vectors,
    v.loops.map(l => ({ position: position(l), parallel: parallel(l.bind) })),
  );
  if (!found) return undefined;
  const loop = v.loops.find(l => position(l) === found.position)!;
  return found.kind === 'parallel'
    ? `reduction loop ${loop.id} is bound to ${loop.bind}: its iterations depend on each other (a reassociation)`
    : `loop ${loop.id} is outside the loops that order it (nest ${v.loops.map(l => l.id).join(' ')}, ` +
        `dependence ${found.vector.join(' ')}): an output would not accumulate its terms in the source's order`;
}

const sharedTileLimit = 48 * 1024;
/** Elements of an operand tile staged at `at`: every point of the loops inside it and of the block's thread loops. */
export function tileElements(v: Variant, operand: 'm' | 'n', at: string): number | undefined {
  const inside = v.loops.slice(v.loops.findIndex(l => l.id === at) + 1);
  const covered = v.loops.filter(
    l => (l.dim === operand || l.dim === 'r') && (inside.includes(l) || l.bind.startsWith('thread.')),
  );
  return covered.some(l => l.factor === null) ? undefined : covered.reduce((p, l) => p * l.factor!, 1);
}

/** Why a variant is not a legal schedule of a contraction, or undefined. */
function variantViolation(v: Variant): string | undefined {
  try {
    validateVariant(v);
  } catch (error) {
    return (error as Error).message;
  }
  // Coverage: level 0 takes the rest of the extent, ceil(extent / the inner factors), and a point at or past the
  // extent is skipped, so the levels of a dim reach each of its values exactly once (quotient and remainder).
  const open = v.loops.find(l => l.level === 0 && l.factor !== null);
  if (open) return `${open.id} has a fixed number of iterations, so it does not cover every extent`;
  for (const l of v.loops) {
    if ((l.bind.startsWith('thread.') || l.bind === 'unroll') && l.factor === null)
      return `${l.id} is bound to ${l.bind} and has no fixed number of iterations`;
    if (parallel(l.bind) && l.bind !== 'thread' && v.loops.some(x => x !== l && x.bind === l.bind))
      return `${l.bind} is bound twice`;
  }
  const order = accumulationViolation(v);
  if (order) return order;
  for (const [i, st] of v.stages.entries()) {
    if (v.loops.find(l => l.id === st.at)!.dim !== 'r') return `${st.at} is not a reduction loop`;
    if (v.stages.findIndex(x => x.operand === st.operand) !== i)
      return `the ${st.operand} operand is staged twice`;
    if (st.fast !== 'r' && st.fast !== st.operand)
      return `the ${st.operand} operand does not vary with ${st.fast}`;
    const n = tileElements(v, st.operand, st.at);
    if (n === undefined) return 'a loop inside the stage has no fixed number of iterations';
    // half the limit: the other operand's tile and the padding of four floats per row share it
    if (n * 4 * 2 > sharedTileLimit) return `the tile (${n} floats) does not fit ${sharedTileLimit} bytes`;
  }
  return undefined;
}

/**
 * Whether a loop plan is legal on a schedule (the trusted part of loop scheduling): each named kernel is a
 * pointwise kernel with a tileable contraction, every variant covers its dims, keeps the accumulation order and
 * fits its bindings and tiles, and the launch rule ends with an entry that accepts every grid.
 */
export function loopsEligible(s: Schedule, plan: LoopPlan): CheckResult {
  if (!Array.isArray(plan?.kernels)) return no('the plan is not a list of kernels');
  const seen = new Set<string>();
  for (const entry of plan.kernels) {
    if (seen.has(entry.kernel)) return no(`${entry.kernel} is scheduled twice`);
    seen.add(entry.kernel);
    const found = contractionOf(s, entry.kernel);
    if (typeof found === 'string') return no(found);
    if (!Array.isArray(entry.variants) || !entry.variants.length)
      return no(`${entry.kernel} needs a variant`);
    for (const [i, v] of entry.variants.entries()) {
      const why = variantViolation(v);
      if (why) return no(`${entry.kernel} variant ${i}: ${why}`);
    }
    const rule = entry.select;
    if (!Array.isArray(rule) || !rule.length || rule.at(-1)!.minBlocks !== 0 || rule.at(-1)!.minTerms)
      return no(`${entry.kernel}: the last entry of the launch rule must accept every grid`);
    if (rule.some(e => !entry.variants[e.variant] || !(e.minBlocks >= 0) || !((e.minTerms ?? 0) >= 0)))
      return no(`${entry.kernel}: the launch rule names a missing variant`);
  }
  return ok;
}

/** Loop scheduling: the named pointwise kernels become contraction kernels with the plan's variants and rule. */
export const loopsPass = planPass<LoopPlan>({
  name: 'loops',
  description:
    'Give each contraction kernel the loop nests, bindings, staged tiles and launch rule of the plan',
  eligible: loopsEligible,
  prepare: (s, plan) => ({
    native: {
      fn: s.fn,
      kernels: s.kernels.map((k): ScheduleKernel => {
        const entry = plan.kernels.find(e => e.kernel === k.name);
        if (!entry) return k;
        const { statement, form } = contractionOf(s, k.name) as Exclude<
          ReturnType<typeof contractionOf>,
          string
        >;
        return {
          name: k.name,
          kind: 'contraction',
          group: k.group,
          contraction: statement,
          dims: form.dims,
          operands: form.operands,
          variants: structuredClone(entry.variants) as Variant[],
          select: structuredClone(entry.select) as Selection[],
        };
      }),
    },
  }),
  conforms: (candidate, plan, before) => {
    const planned = new Map(plan.kernels.map(e => [e.kernel, e]));
    const realized = (k: ScheduleKernel) =>
      k.kind === 'contraction' ? { kernel: k.name, variants: k.variants, select: k.select } : k;
    return canonical(candidate.kernels.map(realized)) ===
      canonical(before.kernels.map(k => planned.get(k.name) ?? k))
      ? ok
      : no('the kernels are not the loop nests of the plan');
  },
});
