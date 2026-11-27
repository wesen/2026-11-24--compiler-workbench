// IRWB-033-D: the schedule IR, a v6 artifact between Tix and CUDA (design-doc/01 in the ticket).
//
// A schedule holds the algorithm (the Tix function, unchanged) and one schedule kernel per CUDA kernel:
//   - pointwise: one thread per element, members in registers (stage 2's kernels and stage 3's thread mode);
//   - rows: stage 3/3b block mode, its FusionGroup unchanged (staged terms, in-place rows, the gate);
//   - contraction: a pointwise group whose one reduction is a tileable contraction, with variants. Each variant is a
//     loop nest over four flattened dims (b: batch, m and n: the output axes only one operand reads, r: the
//     reduction axes in the meaning's order) and the operand tiles it stages in shared memory. The host picks a
//     variant at launch (`select`).
// Scheduling steps are v6 passes with a legality check decided from the IR (`legal`) and a correspondence to the
// revision before. Every application is gated by `accumulationOrder`, which must not change.
import { defineIR, type CheckResult } from '../framework/contracts/index.js';
import { defineAdapter, type CorrespondenceEntry, type IREntity, type IRRelation } from '../framework/ir/index.js';
import { applyNativePassSync, definePass, type PassResult } from '../framework/passes/index.js';
import { createIRArtifact } from '../framework/ir/index.js';
import type { Artifact } from '../framework/core/types.js';
import { outerReductions, planFusion, type FusionGroup, type FusionPlan, type Reduce } from './fusion.js';
import { visit, type Expr, type Fn, type Statement } from './model.js';

export type Dim = 'b' | 'm' | 'n' | 'r';
export const dimsInOrder: readonly Dim[] = ['b', 'm', 'n', 'r'];
export type Bind = 'serial' | 'thread' | 'block.x' | 'block.y' | 'block.z' | 'thread.x' | 'thread.y' | 'unroll';
const binds: readonly Bind[] = ['serial', 'thread', 'block.x', 'block.y', 'block.z', 'thread.x', 'thread.y', 'unroll'];
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
  /** At launch, the first entry whose grid has at least minBlocks per SM wins; the last has minBlocks 0. */
  select: { variant: number; minBlocks: number }[];
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
      require(
        i === 0
          ? l.factor === null || (Number.isSafeInteger(l.factor) && l.factor > 0)
          : Number.isSafeInteger(l.factor) && l.factor! > 0,
        'Invalid loop factor',
      );
      require(binds.includes(l.bind), 'Invalid loop binding');
    });
  }
  for (const s of v.stages)
    require(
      ['m', 'n'].includes(s.operand) && ids.has(s.at) && s.scope === 'shared' && dimsInOrder.includes(s.fast),
      'Invalid stage',
    );
}
function validate(value: unknown) {
  const s = value as Schedule;
  require(s && typeof s.fn?.name === 'string' && Array.isArray(s.kernels), 'Invalid schedule');
  require(new Set(s.kernels.map(k => k.name)).size === s.kernels.length, 'Duplicate kernel name');
  const statements = new Set(s.fn.statements.map(t => t.name));
  const covered = s.kernels.flatMap(k => k.group.statements);
  require(
    covered.length === statements.size && covered.every(n => statements.has(n)),
    'Kernels must cover every statement once',
  );
  for (const k of s.kernels) {
    require(['pointwise', 'rows', 'contraction'].includes(k.kind), 'Invalid kernel kind');
    if (k.kind !== 'contraction') continue;
    require(k.group.statements.includes(k.contraction), 'Contraction outside its kernel');
    require(k.variants.length > 0, 'A contraction kernel needs a variant');
    k.variants.forEach(validateVariant);
    require(
      k.select.length > 0 &&
        k.select.every(e => Number.isSafeInteger(e.variant) && e.variant >= 0 && e.variant < k.variants.length) &&
        k.select.at(-1)!.minBlocks === 0,
      'Invalid variant selection',
    );
  }
}
function* entities(s: Schedule): Generator<IREntity> {
  for (const k of s.kernels) {
    const { name, kind, group } = k;
    const attributes: Record<string, unknown> = { kind, group };
    if (k.kind === 'contraction')
      Object.assign(attributes, { contraction: k.contraction, dims: k.dims, operands: k.operands, select: k.select });
    yield { id: name, kind: 'kernel', attributes };
    if (k.kind !== 'contraction') continue;
    for (const [v, variant] of k.variants.entries()) {
      yield { id: `${name}/v${v}`, kind: 'variant', attributes: { order: variant.loops.map(l => l.id) } };
      for (const l of variant.loops) yield { id: `${name}/v${v}/${l.id}`, kind: 'loop', attributes: { ...l } };
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
  description: 'A Tix function and the schedule of its kernels: fused groups and tiled contraction loop nests',
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

// ---- the order analysis ----

/** The nest's iteration space at concrete dim extents: calls `visit` with each point's dim values, in nest order. */
export function simulate(
  loops: readonly Loop[],
  extents: Record<Dim, number>,
  visitPoint: (point: Record<Dim, number>) => void,
  only: (l: Loop) => boolean = () => true,
) {
  const nest = loops.filter(only);
  const inner = nest.map(l =>
    loops.filter(x => x.dim === l.dim && x.level > l.level).reduce((p, x) => p * x.factor!, 1),
  );
  const trips = nest.map((l, i) => l.factor ?? Math.ceil(extents[l.dim] / inner[i]));
  const index = nest.map(() => 0);
  const walk = (depth: number) => {
    if (depth === nest.length) {
      const point = { b: 0, m: 0, n: 0, r: 0 };
      nest.forEach((l, i) => (point[l.dim] += index[i] * inner[i]));
      visitPoint(point);
      return;
    }
    for (index[depth] = 0; index[depth] < trips[depth]; index[depth]++) walk(depth + 1);
  };
  walk(0);
}

const parallel = (b: Bind) => b !== 'serial' && b !== 'unroll';
/** Why a variant does not accumulate every output over r = 0, 1, ..., R - 1 with its own accumulator, or undefined. */
const violations = new Map<string, string | undefined>();
export function orderViolation(v: Variant): string | undefined {
  const key = JSON.stringify(v.loops);
  if (!violations.has(key)) violations.set(key, findViolation(v));
  return violations.get(key);
}
function findViolation(v: Variant): string | undefined {
  const bound = v.loops.find(l => l.dim === 'r' && parallel(l.bind));
  if (bound) return `reduction loop ${bound.id} is bound to ${bound.bind} (a reassociation)`;
  // The accumulator is indexed by the output point, so loops of other dims do not change the sequence of terms one
  // output receives: it is the enumeration of the r loops alone, in nest order. Likewise each output dim's loops
  // alone must reach every value of that dim exactly once. Small extents that are not multiples of any factor the
  // strategy uses, and single-term and empty reductions.
  for (const extents of [
    { b: 2, m: 5, n: 3, r: 11 },
    { b: 1, m: 7, n: 2, r: 1 },
    { b: 3, m: 1, n: 1, r: 0 },
  ])
    for (const d of dimsInOrder) {
      const seen: number[] = [];
      simulate(
        v.loops,
        extents,
        p => {
          if (p[d] < extents[d]) seen.push(p[d]);
        },
        l => l.dim === d,
      );
      const want = Array.from({ length: extents[d] }, (_, i) => i);
      if (d === 'r' ? seen.join() !== want.join() : [...seen].sort((x, y) => x - y).join() !== want.join())
        return d === 'r'
          ? `with ${extents.r} terms, an output accumulates r in the order ${seen.join(' ')}`
          : `dim ${d} of extent ${extents[d]} is covered as ${[...seen].sort((x, y) => x - y).join(' ')}`;
    }
  return undefined;
}

/**
 * For each statement with a reduction, the order in which every output accumulates each of its reductions. Kernels
 * printed with stage 2's scalar code have the meaning's order by construction (stages 2, 3 and 3b); a contraction
 * kernel has it when every variant passes `orderViolation`.
 */
export function accumulationOrder(s: Schedule): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const statements = new Map(s.fn.statements.map(t => [t.name, t]));
  for (const k of s.kernels)
    for (const name of k.group.statements) {
      const rs = reductions(statements.get(name)!.expr);
      if (!rs.length) continue;
      out[name] = rs.map(r => `lexicographic(${r.axes.map(a => a.id).join(',')})`);
      if (k.kind === 'contraction' && name === k.contraction)
        k.variants.forEach((v, i) => {
          const why = orderViolation(v);
          if (why) out[name] = [`variant ${i}: ${why}`];
        });
    }
  return out;
}
export function orderGate(before: Artifact<Schedule>, after: Artifact<Schedule>): CheckResult {
  const a = accumulationOrder(before.value),
    b = accumulationOrder(after.value);
  const changed = Object.keys({ ...a, ...b }).filter(n => JSON.stringify(a[n]) !== JSON.stringify(b[n]));
  return changed.length
    ? {
        ok: false,
        reason: `accumulation order of ${changed[0]} changed: ${JSON.stringify(a[changed[0]])} to ${JSON.stringify(b[changed[0]])}`,
        evidence: { before: a, after: b },
      }
    : { ok: true, evidence: { order: b } };
}

// ---- passes ----

const ok: CheckResult = { ok: true };
const no = (reason: string): CheckResult => ({ ok: false, reason });
/** A copy whose variants a pass may change; the function and the fusion groups stay shared (they are frozen). */
const editable = (s: Schedule): Schedule => ({
  fn: s.fn,
  kernels: s.kernels.map(k =>
    k.kind === 'contraction'
      ? {
          ...k,
          variants: k.variants.map(v => ({ loops: v.loops.map(l => ({ ...l })), stages: v.stages.map(x => ({ ...x })) })),
          select: k.select.map(e => ({ ...e })),
        }
      : k,
  ),
});
type Native = { native: Schedule; correspondence?: CorrespondenceEntry[]; report?: unknown };
function schedulePass<P>(
  name: string,
  description: string,
  legal: (s: Schedule, p: P) => CheckResult,
  run: (s: Schedule, p: P) => Native,
) {
  return definePass<Schedule, {}, P>({
    id: 'tensor.schedule.' + name,
    version: '1',
    description,
    ir: ScheduleIR,
    adapter: scheduleAdapter,
    writes: { entities: ['kernel', 'variant', 'loop', 'stage'], relations: ['contains'] },
    legal: ({ before, params }) => legal(before.value, params),
    run: ({ before, params }) => run(editable(before.value), params),
  });
}
const contractionKernel = (s: Schedule, kernel: string) => {
  const k = s.kernels.find(x => x.name === kernel);
  return k?.kind === 'contraction' ? k : undefined;
};
interface VariantRef {
  kernel: string;
  variant: number;
}
const variantOf = (s: Schedule, p: VariantRef) => contractionKernel(s, p.kernel)?.variants[p.variant];
const loopOf = (s: Schedule, p: VariantRef & { loop: string }) => variantOf(s, p)?.loops.find(l => l.id === p.loop);

/** Schedule kernels for a fusion plan: block-mode groups are rows kernels, the others pointwise. */
export function scheduleKernels(plan: FusionPlan): ScheduleKernel[] {
  return plan.groups.map(group => ({ name: group.kernel, kind: group.mapping === 'block' ? 'rows' : 'pointwise', group }));
}
export function initialSchedule(fn: Fn, plan: FusionPlan): Artifact<Schedule> {
  return createIRArtifact(scheduleAdapter, 'tix-schedule/' + fn.name, { fn, kernels: scheduleKernels(plan) });
}
const tileable = (fn: Fn) => fn.statements.filter(s => typeof contractionForm(s) !== 'string').map(s => s.name);

/** Fission: re-plan fusion so that no tileable contraction is computed in block mode. */
export const isolatePass = schedulePass<{}>(
  'isolate',
  'Take tileable contractions out of block-mode kernels (planFusion with noBlock)',
  s =>
    s.kernels.some(k => k.kind === 'rows' && k.group.statements.some(n => tileable(s.fn).includes(n)))
      ? ok
      : no('no block-mode kernel computes a tileable contraction'),
  s => {
    const kernels = scheduleKernels(planFusion(s.fn, { noBlock: new Set(tileable(s.fn)) }));
    // Correspondence by statements: connected groups of old and new kernels that share a statement.
    const entries: CorrespondenceEntry[] = [];
    const left = new Set(s.kernels.map(k => k.name));
    for (const start of s.kernels) {
      if (!left.has(start.name)) continue;
      const from = new Set([start.name]),
        to = new Set<string>();
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of kernels)
          if (!to.has(n.name) && n.group.statements.some(t => s.kernels.some(o => from.has(o.name) && o.group.statements.includes(t))))
            (to.add(n.name), (grew = true));
        for (const o of s.kernels)
          if (!from.has(o.name) && o.group.statements.some(t => kernels.some(n => to.has(n.name) && n.group.statements.includes(t))))
            (from.add(o.name), (grew = true));
      }
      from.forEach(n => left.delete(n));
      entries.push({ from: [...from], to: [...to], relation: from.size === 1 && to.size === 1 ? 'retained' : 'refused-fusion' });
    }
    return { native: { ...s, kernels }, correspondence: entries };
  },
);

/** A pointwise kernel whose one reduction is a tileable contraction becomes a contraction kernel with variant 0. */
export const contractionPass = schedulePass<{ kernel: string }>(
  'contraction',
  'Give a pointwise kernel with a tileable contraction its loop nest; variant 0 is one thread per output',
  (s, { kernel }) => {
    const k = s.kernels.find(x => x.name === kernel);
    if (k?.kind !== 'pointwise') return no(`${kernel} is not a pointwise kernel`);
    const members = k.group.statements.map(n => s.fn.statements.find(t => t.name === n)!);
    const reducing = members.filter(m => reductions(m.expr).length);
    if (reducing.length !== 1) return no(`${kernel} has ${reducing.length} members with a reduction, not one`);
    const form = contractionForm(reducing[0], new Set(k.group.statements));
    return typeof form === 'string' ? no(`${reducing[0].name}: ${form}`) : ok;
  },
  (s, { kernel }) => {
    const i = s.kernels.findIndex(x => x.name === kernel);
    const { group } = s.kernels[i];
    const statement = group.statements
      .map(n => s.fn.statements.find(t => t.name === n)!)
      .find(m => reductions(m.expr).length)!;
    const form = contractionForm(statement, new Set(group.statements)) as Exclude<
      ReturnType<typeof contractionForm>,
      string
    >;
    const loops: Loop[] = dimsInOrder.map(dim => ({
      id: dim + '.0',
      dim,
      level: 0,
      factor: null,
      bind: dim === 'r' ? 'serial' : 'thread',
    }));
    s.kernels[i] = {
      name: kernel,
      kind: 'contraction',
      group,
      contraction: statement.name,
      dims: form.dims,
      operands: form.operands,
      variants: [{ loops, stages: [] }],
      select: [{ variant: 0, minBlocks: 0 }],
    };
    return { native: s };
  },
);

/** A new variant: the unscheduled nest (every loop serial), to be scheduled by the passes below. */
export const variantPass = schedulePass<{ kernel: string }>(
  'variant',
  'Add a variant of a contraction kernel: its nest b, m, n, r, all serial',
  (s, { kernel }) => (contractionKernel(s, kernel) ? ok : no(`${kernel} is not a contraction kernel`)),
  (s, { kernel }) => {
    const k = contractionKernel(s, kernel)!;
    k.variants.push({
      loops: dimsInOrder.map(dim => ({ id: dim + '.0', dim, level: 0, factor: null, bind: 'serial' })),
      stages: [],
    });
    return { native: s };
  },
);

/** Split loop L of dim d at level l into L (outer) and a new level l + 1 of `factor` iterations, right inside it. */
export const splitPass = schedulePass<VariantRef & { loop: string; factor: number }>(
  'split',
  'Split a loop into an outer loop and an inner loop of a fixed number of iterations',
  (s, p) => {
    const l = loopOf(s, p);
    if (!l) return no(`no loop ${p.loop} in ${p.kernel} variant ${p.variant}`);
    if (l.bind !== 'serial') return no(`${p.loop} is bound to ${l.bind}`);
    if (!Number.isSafeInteger(p.factor) || p.factor < 1) return no('the factor must be a positive integer');
    if (l.factor !== null && l.factor % p.factor) return no(`${p.factor} does not divide ${l.factor}`);
    return ok;
  },
  (s, p) => {
    const v = variantOf(s, p)!;
    const l = v.loops.find(x => x.id === p.loop)!;
    const prefix = `${p.kernel}/v${p.variant}/`;
    const entries: CorrespondenceEntry[] = [];
    const deeper = v.loops.filter(x => x.dim === l.dim && x.level > l.level).sort((a, b) => b.level - a.level);
    for (const x of deeper) {
      const id = `${x.dim}.${x.level + 1}`;
      entries.push({ from: [prefix + x.id], to: [prefix + id], relation: 'renamed' });
      Object.assign(x, { id, level: x.level + 1 });
    }
    const inner: Loop = { id: `${l.dim}.${l.level + 1}`, dim: l.dim, level: l.level + 1, factor: p.factor, bind: 'serial' };
    if (l.factor !== null) l.factor /= p.factor;
    v.loops.splice(v.loops.indexOf(l) + 1, 0, inner);
    entries.push({ from: [prefix + l.id], to: [prefix + l.id, prefix + inner.id], relation: 'split' });
    for (const st of v.stages) if (deeper.some(x => x.id === st.at)) throw Error('unreachable: stage at a renamed loop');
    return { native: s, correspondence: entries };
  },
);

/** Permute the nest. Reduction loops keep their relative order (so each output's term order is unchanged). */
export const reorderPass = schedulePass<VariantRef & { order: string[] }>(
  'reorder',
  'Permute the loops of a variant',
  (s, p) => {
    const v = variantOf(s, p);
    if (!v) return no(`no variant ${p.variant} of ${p.kernel}`);
    const ids = v.loops.map(l => l.id);
    if (p.order.length !== ids.length || !ids.every(id => p.order.includes(id)))
      return no('the order is not a permutation of the loops');
    const r = (list: string[]) => list.filter(id => id.startsWith('r.')).join();
    if (r(p.order) !== r(ids)) return no(`reduction loops ${r(ids)} would become ${r(p.order)}`);
    return ok;
  },
  (s, p) => {
    const v = variantOf(s, p)!;
    v.loops = p.order.map(id => v.loops.find(l => l.id === id)!);
    return { native: s };
  },
);

/** Bind a loop to a hardware index or unroll it. */
export const bindPass = schedulePass<VariantRef & { loop: string; target: Bind }>(
  'bind',
  'Bind a loop to a block or thread index, or unroll it',
  (s, p) => {
    const v = variantOf(s, p),
      l = loopOf(s, p);
    if (!v || !l) return no(`no loop ${p.loop} in ${p.kernel} variant ${p.variant}`);
    if (!binds.includes(p.target)) return no(`unknown target ${p.target}`);
    if (l.dim === 'r' && parallel(p.target))
      return no(`${p.loop} is a reduction loop; binding it to ${p.target} would reassociate the sum`);
    if (parallel(p.target) && p.target !== 'thread' && v.loops.some(x => x !== l && x.bind === p.target))
      return no(`${p.target} is already bound`);
    if ((p.target.startsWith('thread.') || p.target === 'unroll') && l.factor === null)
      return no(`${p.loop} has no fixed number of iterations`);
    return ok;
  },
  (s, p) => {
    loopOf(s, p)!.bind = p.target;
    return { native: s };
  },
);

const sharedTileLimit = 48 * 1024;
/** Elements of an operand tile staged at `at`: every point of the loops inside it and of the block's thread loops. */
export function tileElements(v: Variant, operand: 'm' | 'n', at: string): number | undefined {
  const inside = v.loops.slice(v.loops.findIndex(l => l.id === at) + 1);
  const covered = v.loops.filter(
    l => (l.dim === operand || l.dim === 'r') && (inside.includes(l) || l.bind.startsWith('thread.')),
  );
  return covered.some(l => l.factor === null) ? undefined : covered.reduce((p, l) => p * l.factor!, 1);
}
/** Copy an operand's tile to shared memory at every iteration of an r loop. */
export const stagePass = schedulePass<VariantRef & { operand: 'm' | 'n'; at: string; fast: Dim }>(
  'stage',
  "Stage an operand's tile in shared memory",
  (s, p) => {
    const v = variantOf(s, p);
    const at = v?.loops.find(l => l.id === p.at);
    if (!v || !at) return no(`no loop ${p.at} in ${p.kernel} variant ${p.variant}`);
    if (at.dim !== 'r') return no(`${p.at} is not a reduction loop`);
    if (v.stages.some(x => x.operand === p.operand)) return no(`the ${p.operand} operand is already staged`);
    if (p.fast !== 'r' && p.fast !== p.operand) return no(`the ${p.operand} operand does not vary with ${p.fast}`);
    const n = tileElements(v, p.operand, p.at);
    if (n === undefined) return no('a loop inside the stage has no fixed number of iterations');
    // half the limit: the other operand's tile and the padding of four floats per row share it
    if (n * 4 * 2 > sharedTileLimit) return no(`the tile (${n} floats) does not fit ${sharedTileLimit} bytes`);
    return ok;
  },
  (s, p) => {
    variantOf(s, p)!.stages.push({ operand: p.operand, at: p.at, scope: 'shared', fast: p.fast });
    return { native: s };
  },
);

/** The launch rule over the kernel's variants. */
export const selectPass = schedulePass<{ kernel: string; rule: { variant: number; minBlocks: number }[] }>(
  'select',
  'Set the launch-time rule that picks a variant from the grid size',
  (s, { kernel, rule }) => {
    const k = contractionKernel(s, kernel);
    if (!k) return no(`${kernel} is not a contraction kernel`);
    if (!rule.length || rule.at(-1)!.minBlocks !== 0) return no('the last entry must accept every grid');
    if (rule.some(e => !k.variants[e.variant] || !(e.minBlocks >= 0))) return no('the rule names a missing variant');
    return ok;
  },
  (s, { kernel, rule }) => {
    contractionKernel(s, kernel)!.select = rule;
    return { native: s };
  },
);

/** Apply a schedule pass, gated by the accumulation order. */
export function applyStep<P>(
  pass: ReturnType<typeof schedulePass<P>>,
  before: Artifact<Schedule>,
  params: P,
): PassResult<Schedule> {
  return applyNativePassSync(pass, before, orderGate, params);
}
