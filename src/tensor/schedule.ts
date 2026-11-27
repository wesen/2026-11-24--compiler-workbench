// IRWB-033-J: the schedule IR, a v6 artifact between Tix and CUDA, in the spirit of Halide's and TVM's split
// between algorithm and schedule. The value carries the algorithm (a frozen copy of the Tix function) and the
// schedule (one record per kernel: mapping, rows, terms, tiling). Scheduling steps are v6 passes on this IR
// (fusion, tiling, double buffering), each gated by the order certificate below, and the emitter (cuda-source)
// only prints a schedule: every decision is a field the passes set.
//
// Exactness: every output element still accumulates its terms one at a time in the meaning's order, rounding
// the product and the sum separately. `checkOrder` proves from the IR that no pass broke that: it classifies
// every reduction of every member as one of three constructions, each with its order argument, and re-verifies
// the tiled ones structurally (the tile binds threads and patches to output axes only; the chunk loop and the
// in-chunk loop both increase, so the visited order is 0, 1, 2, ...; one accumulator per output element).
import {
  defineAnalysis,
  defineIR,
  defineProperty,
  defineTransformation,
  defineType,
  type CheckResult,
} from '../framework/contracts/index.js';
import { createIRArtifact, defineAdapter, type CorrespondenceEntry, type IREntity, type IRRelation } from '../framework/ir/index.js';
import {
  applyNativePassSync,
  definePass,
  type Pass,
  type PassResult,
} from '../framework/passes/index.js';
import {
  blockThreads,
  gate,
  outerReductions,
  planFusion,
  type FusionGroup,
  type FusionPlan,
  type FusionRefusal,
} from './fusion.js';
import { TixIR, validateTixFn } from './ir.js';
import { plain, visit, type Axis, type Expr, type Fn, type Statement } from './model.js';

export type Mapping = 'thread' | 'block' | 'gemm';
/** The host's thread-count rule, printed by the emitter from these constants (no decision in the emitter). */
export interface ThreadRule {
  mode: 'fixed' | 'rows' | 'patch';
  count?: number;
  cap?: number;
  heavyCap?: number;
}
/** A standalone contraction (one statement, one kernel): both operands staged in padded shared tiles. */
export interface GemmTile {
  kind: 'gemm';
  /** The output axes carried by the row operand and by the staged operand, in statement order (each at most one). */
  rowAxes: string[];
  colAxes: string[];
  reduction: string;
  row: string;
  staged: string;
  block: [number, number];
  chunk: number;
  patch: [number, number];
  pad: number;
  doubleBuffer: boolean;
}
/** A contraction member of a block-mode kernel: the staged operand's tile, one reduction chunk deep. */
export interface MemberTile {
  statement: string;
  reduction: string;
  row: string;
  staged: string;
  chunk: number;
  pad: number;
}
export interface SkKernel extends Omit<FusionGroup, 'mapping'> {
  mapping: Mapping;
  threads: ThreadRule;
  gate?: { fullRow: number; smallGrid: number; heavyLanes: [number, number] };
  tile?: GemmTile;
  memberTiles?: MemberTile[];
}
export interface ScheduleUnit {
  fn: string;
  program: Fn;
  kernels: SkKernel[];
  /** Why statements did not share a kernel (the fuse pass). */
  refusals: FusionRefusal[];
  /** Why contraction members were not tiled (the tile pass). */
  tileRefusals: FusionRefusal[];
}
const numbers = (x: unknown, n: number) =>
  Array.isArray(x) && x.length === n && x.every(v => typeof v === 'number' && Number.isSafeInteger(v) && v > 0);

function validateKernel(k: SkKernel, tensors: Map<string, unknown>) {
  if (typeof k.kernel !== 'string' || !k.kernel) throw Error('Invalid schedule kernel name');
  if (!['thread', 'block', 'gemm'].includes(k.mapping)) throw Error('Invalid schedule mapping');
  if (typeof k.depth !== 'number' || !(k.depth >= 1)) throw Error('Invalid schedule depth');
  for (const list of [k.statements, k.stored, k.buffered, k.staged, k.heavy] as const)
    if (!Array.isArray(list) || list.some(s => typeof s !== 'string')) throw Error('Invalid kernel statement list');
  for (const s of k.statements)
    if (!tensors.has(s)) throw Error(`Schedule kernel ${k.kernel} names unknown statement ${s}`);
  for (const t of k.terms ?? [])
    if (typeof t?.statement !== 'string' || !tensors.has(t.statement) || !Number.isInteger(t.reduction))
      throw Error('Invalid staged-terms entry');
  for (const p of k.inPlace ?? [])
    if (typeof p?.statement !== 'string' || !tensors.has(p.statement) || !tensors.has(p.over))
      throw Error('Invalid in-place entry');
  if (typeof k.threads !== 'object' || !['fixed', 'rows', 'patch'].includes(k.threads?.mode))
    throw Error('Invalid thread rule');
  if (k.mapping !== 'block' && (k.memberTiles?.length ?? 0)) throw Error('Operand tiles outside a block kernel');
  for (const t of k.memberTiles ?? [])
    if (
      typeof t?.statement !== 'string' ||
      !tensors.has(t.statement) ||
      typeof t.reduction !== 'string' ||
      typeof t.row !== 'string' ||
      typeof t.staged !== 'string' ||
      !(typeof t.chunk === 'number' && t.chunk > 0) ||
      !(typeof t.pad === 'number' && t.pad >= 0)
    )
      throw Error('Invalid operand tile');
  const g = k.tile;
  if (g && (g.kind !== 'gemm' || !numbers(g.block, 2) || !numbers(g.patch, 2) || !(g.chunk > 0) || !(g.pad >= 0)))
    throw Error('Invalid gemm tile');
  if (k.mapping === 'gemm' && !g) throw Error('A gemm kernel needs its tile');
}
function validateUnit(value: unknown) {
  const unit = value as Partial<ScheduleUnit> | null;
  if (typeof unit?.fn !== 'string' || !unit.fn) throw Error('Invalid schedule function name');
  validateTixFn(unit.program as Fn);
  if (!Array.isArray(unit.kernels)) throw Error('Invalid schedule kernels');
  const program = unit.program as Fn;
  const tensors = new Map<string, unknown>();
  for (const t of [...program.params, ...program.statements]) tensors.set(t.name, t);
  unit.kernels.forEach(k => validateKernel(k as SkKernel, tensors));
  for (const list of [unit.refusals, unit.tileRefusals] as const)
    if (!Array.isArray(list) || list.some(r => typeof r?.statement !== 'string' || typeof r.reason !== 'string'))
      throw Error('Invalid schedule refusals');
}

export const ScheduleIR = defineIR<ScheduleUnit>({
  id: 'tensor.schedule',
  version: '1',
  description: 'A Tix function (the algorithm) and one schedule record per kernel',
  validate: validateUnit,
  entities: unit => [
    unit.fn,
    ...unit.kernels.flatMap(k => [k.kernel, ...k.statements.map(s => k.kernel + '/' + s)]),
  ],
});
function* entities(unit: ScheduleUnit): Generator<IREntity> {
  yield { id: unit.fn, kind: 'function', attributes: { statements: unit.program.statements.length } };
  for (const k of unit.kernels) {
    yield { id: k.kernel, kind: 'kernel', attributes: { mapping: k.mapping, depth: k.depth } };
    for (const s of k.statements)
      yield { id: k.kernel + '/' + s, kind: 'member', attributes: { kernel: k.kernel, statement: s } };
  }
}
function* relations(unit: ScheduleUnit): Generator<IRRelation> {
  let order = 0;
  for (const k of unit.kernels) {
    yield {
      id: 'contains/' + k.kernel,
      from: unit.fn,
      to: k.kernel,
      kind: 'contains',
      category: 'containment',
      order: order++,
    };
    for (const s of k.statements)
      yield {
        id: 'contains/' + k.kernel + '/' + s,
        from: k.kernel,
        to: k.kernel + '/' + s,
        kind: 'contains',
        category: 'containment',
        order: order++,
      };
  }
  const seen = new Set<string>();
  const home = new Map<string, string>();
  for (const k of unit.kernels) for (const s of k.statements) home.set(s, k.kernel);
  for (const k of unit.kernels)
    for (const s of k.statements) {
      const reads = new Set<string>();
      visit(unit.program.statements.find(x => x.name === s)!.expr, e => {
        if (e.kind === 'load' && home.has(e.name)) reads.add(e.name);
      });
      for (const r of reads) {
        const id = 'reads/' + k.kernel + '/' + s + '/' + r;
        if (seen.has(id)) continue;
        seen.add(id);
        yield { id, from: k.kernel + '/' + s, to: home.get(r) + '/' + r, kind: 'reads', category: 'dependency' };
      }
    }
}
export const scheduleAdapter = defineAdapter<ScheduleUnit>({
  id: 'tensor.schedule-adapter',
  version: '1',
  description: 'Kernels, their member statements and the reads between them',
  kind: ScheduleIR.id,
  schemaVersion: ScheduleIR.version,
  validate: validateUnit,
  relationKinds: { contains: 'containment', reads: 'dependency' },
  entities,
  relations,
  roots: unit => [unit.fn],
  resolve: (unit, id) => [...entities(unit)].find(e => e.id === id),
  describe: (_unit, id) => ({ label: id }),
});

// The exact contraction form both tiled paths compute (one implementation, shared by the tile pass and the
// order checker): E(sum(r) L * R), one reduction axis with a plain extent, a body that is exactly a product of
// two loads, both loads at identity, together carrying each output axis exactly once and the reduction axis
// exactly once. `E`, the epilogue, is any scalar tree around the reduction; the validator has already ensured it
// cannot read the reduction's binder, and a second outermost reduction makes the form refused.
export type Load = Extract<Expr, { kind: 'load' }>;
export type Reduce = Extract<Expr, { kind: 'reduce' }>;
export interface Contraction {
  reduce: Reduce;
  axis: Axis;
  row: Load;
  staged: Load;
  /** Where each load's indices carry the reduction axis. */
  rowAt: number;
  stagedAt: number;
  rowAxes: string[];
  colAxes: string[];
}
const isLoad = (e: Expr): e is Load => e.kind === 'load';
export const plainId = (a: unknown): string | undefined => {
  const id = plain(a as never);
  return typeof id === 'string' ? id : undefined;
};

export function contractionOf(s: Statement): { contraction: Contraction } | { refusal: string } {
  const outer = outerReductions(s.expr);
  if (!outer.length) return { refusal: 'the statement has no reduction' };
  if (outer.length > 1) return { refusal: 'the statement has more than one outermost reduction' };
  const reduce = outer[0];
  if (reduce.op !== 'sum') return { refusal: 'the reduction is not a sum' };
  if (reduce.axes.length !== 1) return { refusal: 'the reduction has more than one axis' };
  const [axis] = reduce.axes;
  if (axis.extent.kind !== 'dim') return { refusal: "the reduction's extent comes from split-sum" };
  const body = reduce.body;
  if (body.kind !== 'op' || body.op !== '*' || !body.args.every(isLoad))
    return { refusal: 'the reduction body is not a product of two loads' };
  let nested = false;
  visit(body, e => {
    if (e.kind === 'reduce') nested = true;
  });
  if (nested) return { refusal: 'the reduction body contains another reduction' };
  const outputAxes = new Set(s.axes.map(a => a.id));
  const check = (load: Load) => {
    const ids = load.indices.map(plainId);
    if (ids.some(id => id === undefined)) return { at: -1, ids: [] as string[], ok: false };
    const plain = ids as string[];
    const found: string[] = [];
    let at = -1;
    for (const [position, id] of plain.entries()) {
      if (id === axis.id) {
        if (at >= 0) return { at: -1, ids: [], ok: false };
        at = position;
      } else {
        if (!outputAxes.has(id) || found.includes(id)) return { at: -1, ids: [], ok: false };
        found.push(id);
      }
    }
    return { at, ids: found, ok: at >= 0 };
  };
  for (const [row, staged] of [
    [body.args[0] as Load, body.args[1] as Load],
    [body.args[1] as Load, body.args[0] as Load],
  ]) {
    const a = check(row),
      b = check(staged);
    if (!a.ok || !b.ok) continue;
    const together = [...a.ids, ...b.ids];
    if (new Set(together).size !== together.length || together.length !== s.axes.length) continue;
    return {
      contraction: {
        reduce,
        axis,
        row,
        staged,
        rowAt: a.at,
        stagedAt: b.at,
        rowAxes: s.axes.filter(x => a.ids.includes(x.id)).map(x => x.id),
        colAxes: s.axes.filter(x => b.ids.includes(x.id)).map(x => x.id),
      },
    };
  }
  return { refusal: 'the operands do not carry each output axis once at identity and the reduction axis once' };
}

/** Whether a warp's lanes read the staged operand uncoalesced: they differ in the trailing coordinate, so the
 * reads are strided unless the operand's minor index moves with it. Strided is exactly the case where the minor
 * index is the reduction axis; anywhere else the lanes broadcast or stay consecutive. */
export function lanesUncoalesced(staged: Load, reduction: string): boolean {
  return plainId(staged.indices[staged.indices.length - 1]) === reduction;
}

// The order certificate: how this schedule computes every reduction of every member, with the order argument for
// each class. The gate of every scheduling pass runs the checker on the candidate.
export type OrderClass = 'serial' | 'staged-terms' | 'tiled-serial';
export interface OrderEntry {
  kernel: string;
  statement: string;
  axes: string[];
  kind: OrderClass;
  note: string;
}
export function checkOrder(unit: ScheduleUnit): CheckResult & { certificate: OrderEntry[] } {
  const program = unit.program;
  const tensors = new Map([...program.params, ...program.statements].map(t => [t.name, t]));
  const certificate: OrderEntry[] = [];
  const fail = (reason: string): CheckResult & { certificate: OrderEntry[] } => ({ ok: false, reason, certificate });
  const serial = (kernel: string, statement: string, axes: string[], note: string) =>
    certificate.push({ kernel, statement, axes, kind: 'serial', note });
  for (const k of unit.kernels) {
    const members = k.statements.map(name => program.statements.find(s => s.name === name)!);
    const rowBuffers = new Set([...k.staged, ...k.buffered]);
    const tiles = k.memberTiles ?? [];
    for (const m of members) {
      const outer = outerReductions(m.expr);
      const nested: Reduce[] = [];
      for (const r of outer) visit(r.body, e => void (e.kind === 'reduce' && nested.push(e)));
      for (const r of nested)
        serial(k.kernel, m.name, r.axes.map(a => a.id), 'inside the serial term of an outer reduction');
      for (let i = 0; i < outer.length; i++) {
        const r = outer[i];
        const axes = r.axes.map(a => a.id);
        if (k.terms.some(t => t.statement === m.name && t.reduction === i)) {
          if (m.axes.length !== k.depth)
            return fail(`${k.kernel}/${m.name}: staged terms on a member with trailing axes`);
          certificate.push({
            kernel: k.kernel,
            statement: m.name,
            axes,
            kind: 'staged-terms',
            note: 'terms computed by the block, folded by one thread in row-major order',
          });
          continue;
        }
        const tile = r.axes.length === 1 ? tiles.find(t => t.statement === m.name && t.reduction === axes[0]) : undefined;
        if (tile) {
          const found = contractionOf(m);
          if ('refusal' in found) return fail(`${k.kernel}/${m.name}: tiled, but ${found.refusal}`);
          const c = found.contraction;
          if (
            c.reduce !== r ||
            c.row.name !== tile.row ||
            c.staged.name !== tile.staged ||
            !rowBuffers.has(c.row.name) ||
            c.row.indices.length !== k.depth + 1 ||
            c.row.indices.slice(0, k.depth).some((a, p) => plainId(a) !== m.axes[p]?.id) ||
            plainId(c.row.indices[c.rowAt]) !== c.axis.id ||
            m.axes.length <= k.depth ||
            c.staged.indices.length !== m.axes.length - k.depth + 1
          )
            return fail(`${k.kernel}/${m.name}: the tile does not match the contraction it claims`);
          certificate.push({
            kernel: k.kernel,
            statement: m.name,
            axes,
            kind: 'tiled-serial',
            note: `the reduction is one thread's serial fold over chunks of ${tile.chunk}, in increasing order`,
          });
          continue;
        }
        if (k.mapping === 'gemm') {
          if (members.length !== 1 || m !== members[0])
            return fail(`${k.kernel}: a gemm kernel must have exactly one member`);
          const found = contractionOf(m);
          if ('refusal' in found) return fail(`${k.kernel}: gemm-tiled, but ${found.refusal}`);
          const c = found.contraction,
            t = k.tile!;
          const threads = (t.block[0] / t.patch[0]) * (t.block[1] / t.patch[1]);
          if (
            outer.length !== 1 ||
            c.reduce !== r ||
            t.rowAxes.join() !== c.rowAxes.join() ||
            t.colAxes.join() !== c.colAxes.join() ||
            t.reduction !== c.axis.id ||
            t.row !== c.row.name ||
            t.staged !== c.staged.name ||
            t.block[0] % t.patch[0] ||
            t.block[1] % t.patch[1] ||
            threads % 32 ||
            threads > 1024 ||
            threads !== k.threads.count
          )
            return fail(`${k.kernel}: the gemm tile does not match the contraction it claims`);
          certificate.push({
            kernel: k.kernel,
            statement: m.name,
            axes,
            kind: 'tiled-serial',
            note: `the reduction is one thread's serial fold over ${t.block} tiles of chunk ${t.chunk}, in increasing order`,
          });
          continue;
        }
        serial(
          k.kernel,
          m.name,
          axes,
          k.mapping === 'thread'
            ? "one thread per element, the reduction a loop nest in the meaning's order"
            : "one thread per element of the row (thread 0 for a row scalar), the reduction a loop nest in the meaning's order",
        );
      }
    }
  }
  return { ok: true, reason: 'every reduction classified', certificate };
}
const sameReduction = (a: OrderEntry, b: OrderEntry) =>
  a.statement === b.statement && a.axes.join() === b.axes.join();
/** Which classes a scheduling step may move a reduction between: all three carry an order argument (serial is
 * stage 2's nest, staged-terms stage 3b's fold, tiled-serial the proven tile), so a step may move a reduction
 * between them; what the gate forbids is a reduction appearing, disappearing, changing its axes, or ending up
 * outside the three — `checkOrder` re-verifies every tiled classification structurally. */
const allowedMove = (from: OrderClass, to: OrderClass) =>
  ['serial', 'staged-terms', 'tiled-serial'].includes(from) && ['serial', 'staged-terms', 'tiled-serial'].includes(to);

/** The gate of every scheduling pass: the candidate must classify, and keep every output's accumulation order,
 * class for class. A step may move a reduction to a tiled or staged form; the classes carry the argument. */
export function orderGate(
  before: { value: ScheduleUnit },
  candidate: { value: ScheduleUnit },
): CheckResult {
  const after = checkOrder(candidate.value);
  if (!after.ok) return { ok: false, reason: after.reason };
  const was = checkOrder(before.value);
  if (!was.ok) return { ok: false, reason: 'the schedule before the step does not classify: ' + was.reason };
  if (was.certificate.length !== after.certificate.length)
    return { ok: false, reason: 'the step changed which reductions exist' };
  for (let i = 0; i < was.certificate.length; i++)
    if (
      !sameReduction(was.certificate[i], after.certificate[i]) ||
      !allowedMove(was.certificate[i].kind, after.certificate[i].kind)
    )
      return {
        ok: false,
        reason: `${was.certificate[i].statement}'s reduction ${was.certificate[i].axes.join()} would go from ${was.certificate[i].kind} to ${after.certificate[i].kind}`,
      };
  return { ok: true, reason: 'every reduction keeps its accumulation order' };
}

const Certificate = defineType<{ entries: OrderEntry[]; summary: string }>({
  id: 'tensor.schedule.certificate',
  version: '1',
  description: 'An order certificate and its summary',
  validate(v) {
    const value = v as { entries?: unknown; summary?: unknown };
    if (!Array.isArray(value?.entries) || typeof value.summary !== 'string') throw Error('Invalid certificate');
  },
});
export const ExactOrder = defineAnalysis<ScheduleUnit, { entries: OrderEntry[]; summary: string }>({
  id: 'tensor.schedule.order-certificate',
  version: '1',
  description: 'Classify every reduction the schedule computes and its accumulation-order argument',
  input: ScheduleIR,
  output: Certificate,
  run: (_ctx, artifact) => {
    const result = checkOrder(artifact.value);
    if (!result.ok)
      return {
        ok: false as const,
        reason: result.reason ?? 'rejected',
        entries: [],
        summary: result.reason ?? 'rejected',
      };
    return { ok: true as const, entries: result.certificate, summary: `${result.certificate.length} reductions classified` };
  },
});
export const OrderlySchedule = defineProperty<ScheduleUnit>({
  id: 'tensor.schedule.exact-order',
  version: '1',
  description: 'Every reduction keeps the meaning’s accumulation order under this schedule',
  subject: ScheduleIR,
  check: defineAnalysis<ScheduleUnit, CheckResult>({
    id: 'tensor.schedule.order-check',
    version: '1',
    description: 'Run the order certificate and report its verdict',
    input: ScheduleIR,
    output: defineType<CheckResult>({
      id: 'tensor.schedule.order-verdict',
      version: '1',
      description: 'Order-check verdict',
      validate(v) {
        const verdict = v as CheckResult;
        if (typeof verdict?.ok !== 'boolean') throw Error('Invalid verdict');
      },
    }),
    run(_ctx, artifact) {
      const result = checkOrder(artifact.value);
      return { ok: result.ok, reason: result.reason, evidence: result.certificate };
    },
  }),
});

// The plan step: the trivial schedule, one plain thread-mode kernel per statement. A transformation from the
// Tix artifact, with a correspondence from every Tix statement to its schedule member; the manager checks both
// entity lists against the artifacts (F23/F24). Its ensures runs the order property.
export function planSchedule(fn: Fn): { unit: ScheduleUnit; entries: CorrespondenceEntry[] } {
  const unit: ScheduleUnit = {
    fn: fn.name,
    program: fn,
    kernels: fn.statements.map((s, i): SkKernel => ({
      kernel: 'k' + i,
      statements: [s.name],
      depth: s.axes.length,
      mapping: 'thread',
      stored: [s.name],
      buffered: [],
      staged: [],
      terms: [],
      inPlace: [],
      heavy: [],
      gated: false,
      reasons: [],
      threads: { mode: 'fixed', count: 256 },
    })),
    refusals: [],
    tileRefusals: [],
  };
  return {
    unit,
    entries: fn.statements.map((s, i) => ({
      from: [fn.name + '/' + s.name],
      to: ['k' + i + '/' + s.name],
      relation: 'replace' as const,
    })),
  };
}
export function scheduleArtifact(fn: Fn, unit: ScheduleUnit) {
  return createIRArtifact(scheduleAdapter, 'tix-schedule/' + fn.name, unit);
}
export function planArtifact(fn: Fn) {
  return scheduleArtifact(fn, planSchedule(fn).unit);
}
export function scheduleCorrespondence(
  baseline: { id: string; revision: string },
  subject: { id: string; revision: string },
  unit: ScheduleUnit,
  identity: { id: string; relation: string },
  entries: CorrespondenceEntry[],
) {
  return {
    id: identity.id,
    from: { artifact: baseline.id, revision: baseline.revision },
    to: { artifact: subject.id, revision: subject.revision },
    relation: identity.relation,
    sourceEntities: unit.program.statements.map(s => unit.fn + '/' + s.name),
    targetEntities: [unit.fn, ...unit.kernels.flatMap(k => [k.kernel, ...k.statements.map(s => k.kernel + '/' + s)])],
    entities: entries.map(e => ({ from: e.from, to: e.to })),
    evidence: { relations: entries.map(e => e.relation) },
  };
}
/** The function-name port, shared by the plan step and the lowering (defined once: the registry pins versions). */
export const FunctionName = defineType<string>({
  id: 'tensor.function-name',
  version: '1',
  description: 'Name of the Tix function to lower',
  validate(name) {
    if (typeof name !== 'string' || !name) throw Error('Invalid Tix function name');
  },
});
export const planTransformation = defineTransformation({
  id: 'tensor.plan-schedule',
  version: '1',
  description: 'Plan the trivial schedule for a Tix function: one thread-mode kernel per statement',
  inputs: { baseline: TixIR, fn: FunctionName },
  outputs: { subject: ScheduleIR },
  cache: 'never',
  correspondence: [{ id: 'scheduled-as', from: 'baseline', to: 'subject', relation: 'statements-to-members' }],
  ensures: [{ property: OrderlySchedule, subject: { from: 'outputs', port: 'subject' } }],
  run(_ctx, { baseline, fn }) {
    const f = baseline.value.functions.find(x => x.name === fn);
    if (!f) throw Error('Unknown function ' + fn);
    const { unit, entries } = planSchedule(f);
    const subject = scheduleArtifact(f, unit);
    return {
      outputs: { subject },
      correspondence: [
        scheduleCorrespondence(baseline, subject, unit, { id: 'scheduled-as', relation: 'statements-to-members' }, entries),
      ],
    };
  },
});

function kernelFrom(group: FusionGroup, fn: Fn): SkKernel {
  const rowBuffers = [...group.staged, ...group.buffered];
  const readsGlobal = (e: Expr, inReduction: boolean): boolean =>
    e.kind === 'load'
      ? inReduction && !rowBuffers.includes(e.name)
      : e.kind === 'op'
        ? e.args.some(a => readsGlobal(a, inReduction))
        : e.kind === 'reduce' && readsGlobal(e.body, true);
  const contraction = group.statements.some(name =>
    readsGlobal(fn.statements.find(s => s.name === name)!.expr, false),
  );
  return {
    ...group,
    mapping: group.mapping,
    threads:
      group.mapping === 'thread'
        ? { mode: 'fixed', count: 256 }
        : {
            mode: 'rows',
            cap: contraction ? blockThreads.contraction : blockThreads.rows,
            heavyCap: blockThreads.heavy,
          },
    ...(group.gated && {
      gate: {
        fullRow: gate.fullRow,
        smallGrid: gate.smallGrid,
        heavyLanes: [...gate.heavyLanes] as [number, number],
      },
    }),
    memberTiles: [],
  };
}

// The passes. Each returns the native value, the correspondence to the revision before it, and a report; each is
// gated by `orderGate` when applied.
export const fusePass = definePass<ScheduleUnit>({
  id: 'tensor.schedule.fuse',
  version: '1',
  description: 'Group statements into kernels by stage 3/3b fusion legality, and set their mappings',
  ir: ScheduleIR,
  adapter: scheduleAdapter,
  // merging kernels moves the members (and so their reads edges) between kernels
  writes: { entities: ['kernel', 'member'], relations: ['contains', 'reads'] },
  run: ({ before }) => {
    const unit = before.value;
    const plan: FusionPlan = planFusion(unit.program);
    const kernels = plan.groups.map(g => kernelFrom(g, unit.program));
    const old = new Map(unit.kernels.map(k => [k.statements[0], k.kernel]));
    const entries: CorrespondenceEntry[] = plan.groups.map((g, i) => ({
      from: g.statements.map(s => old.get(s)!),
      to: [kernels[i].kernel],
      relation: 'merge' as const,
    }));
    return {
      native: { ...unit, kernels, refusals: plan.refusals, tileRefusals: [] },
      correspondence: entries,
      edits: plan.groups.filter(g => g.statements.length > 1).length,
      report: `${plan.groups.length} kernels; ${plan.refusals.length} fusion refusals`,
    };
  },
});

export interface TileParams {
  gemm: { block: [number, number]; chunk: number; patch: [number, number]; pad: number };
  member: { chunk: number; pad: number };
}
// The shipped tile sizes (scripts 03 and 04 of this ticket, five timed calls each, digests equal in every
// call): matmul 512^3 was fastest at block 64x64, chunk 64, patch 4x4, pad 1, single-buffered (0.0577 ms,
// 4.65 TFLOP/s). Chunk 32 cost 0.0605, chunk 16 0.0846; pad 4 cost 0.0605; patch 2x2 0.1008 and 8x8 0.1588;
// 128x128 tiles lost (0.152). Double buffering lost at every chunk (0.0638 against 0.0605 at 32, 0.0864 against
// 0.0577 at 64). The operand tile for a block-mode contraction member — attention's score is the corpus case —
// measured slower at every chunk (0.798 ms at 8, 1.010 at 16, against 0.746 with it off), so the shipped member
// chunk is 0: the tile stays legal (the coalescing rule in the tile pass) and checked (the GPU tests run it with
// a positive chunk), but no program the measurements cover asks for it. Both are the schedule-picking rule's
// Both are the schedule-picking rule's constants, data in the strategy plan, not code in the emitter.
export const defaultTileParams: TileParams = {
  gemm: { block: [64, 64], chunk: 64, patch: [4, 4], pad: 1 },
  member: { chunk: 0, pad: 1 },
};
export const tilePass = definePass<ScheduleUnit, {}, TileParams>({
  id: 'tensor.schedule.tile',
  version: '1',
  description: 'Tile contractions: standalone ones as gemm kernels, block-mode members with operand tiles',
  ir: ScheduleIR,
  adapter: scheduleAdapter,
  writes: { entities: ['kernel', 'member'], relations: [] },
  run: ({ before, params }) => {
    const unit = before.value;
    const tensors = new Map([...unit.program.params, ...unit.program.statements].map(t => [t.name, t]));
    const refusals: FusionRefusal[] = [];
    const skip = ['the statement has no reduction', 'the reduction is not a sum', 'the statement has more than one outermost reduction'];
    const kernels = unit.kernels.map(k => {
      const members = k.statements.map(name => unit.program.statements.find(s => s.name === name)!);
      const rowBuffers = new Set([...k.staged, ...k.buffered]);
      const refuse = (statement: string, why: string) => refusals.push({ statement, kernel: k.kernel, reason: why });
      if (k.mapping === 'thread') {
        for (const m of members) {
          const found = contractionOf(m);
          if ('refusal' in found && !skip.includes(found.refusal)) refuse(m.name, found.refusal);
          if ('refusal' in found) continue;
          if (members.length !== 1) {
            refuse(m.name, 'the kernel has more than one member; register-tiled epilogues are a later stage');
            continue;
          }
          const c = found.contraction;
          if (c.rowAxes.length > 1 || c.colAxes.length > 1) {
            refuse(m.name, 'the output has more than two axes; gemm tiling covers one row axis and one column axis');
            continue;
          }
          const tiled: SkKernel = {
            ...k,
            mapping: 'gemm',
            tile: {
              kind: 'gemm',
              rowAxes: c.rowAxes,
              colAxes: c.colAxes,
              reduction: c.axis.id,
              row: c.row.name,
              staged: c.staged.name,
              block: params.gemm.block,
              chunk: params.gemm.chunk,
              patch: params.gemm.patch,
              pad: params.gemm.pad,
              doubleBuffer: false,
            },
            threads: {
              mode: 'patch',
              count: (params.gemm.block[0] / params.gemm.patch[0]) * (params.gemm.block[1] / params.gemm.patch[1]),
            },
          };
          return tiled;
        }
        return k;
      }
      if (k.mapping !== 'block') return k;
      const memberTiles: MemberTile[] = [];
      for (const m of members) {
        const trailing = m.axes.slice(k.depth);
        if (!trailing.length) continue;
        const found = contractionOf(m);
        if ('refusal' in found) {
          if (!skip.includes(found.refusal)) refuse(m.name, found.refusal);
          continue;
        }
        const c = found.contraction;
        // the row operand: a row buffer read at [block indices, reduction]
        const row = tensors.get(c.row.name)!;
        if (
          !rowBuffers.has(c.row.name) ||
          c.row.indices.length !== k.depth + 1 ||
          c.row.indices.slice(0, k.depth).some((a, p) => plainId(a) !== m.axes[p]?.id) ||
          plainId(c.row.indices[c.rowAt]) !== c.axis.id ||
          row.shape.length !== k.depth + 1 ||
          JSON.stringify(row.shape[k.depth]) !== JSON.stringify(c.axis.extent.dim)
        ) {
          refuse(m.name, `the row operand ${c.row.name} is not a row buffer read at [block indices, ${c.axis.id}]`);
          continue;
        }
        const trailingAt = trailing.map(a => c.staged.indices.findIndex(x => plainId(x) === a.id));
        if (
          c.staged.indices.length !== trailing.length + 1 ||
          trailingAt.some(p => p < 0) ||
          new Set(trailingAt).size !== trailingAt.length
        ) {
          refuse(m.name, `the staged operand ${c.staged.name} does not read the trailing axes and ${c.axis.id}`);
          continue;
        }
        if (!lanesUncoalesced(c.staged, c.axis.id)) {
          refuse(
            m.name,
            `${c.staged.name} is read coalesced across the lanes (its minor index follows them); a tile would be a shared round trip with no reuse`,
          );
          continue;
        }
        // the tile is legal; chunk <= 0 is the rule's off switch (script 04: slower on attention at every chunk)
        if (params.member.chunk <= 0) {
          refuse(m.name, `legal for an operand tile, but the rule's member chunk is 0`);
          continue;
        }
        memberTiles.push({
          statement: m.name,
          reduction: c.axis.id,
          row: c.row.name,
          staged: c.staged.name,
          chunk: params.member.chunk,
          pad: params.member.pad,
        });
      }
      return { ...k, memberTiles };
    });
    const tiled = kernels.filter(k => k.mapping === 'gemm').length;
    const staged = kernels.reduce((n, k) => n + (k.memberTiles?.length ?? 0), 0);
    const what = [
      ...(tiled ? [`${tiled} kernel${tiled === 1 ? '' : 's'} tiled`] : []),
      ...(staged ? [`${staged} member${staged === 1 ? '' : 's'} given operand tiles`] : []),
    ].join(', ') || 'nothing tiled';
    return {
      native: { ...unit, kernels, tileRefusals: refusals },
      correspondence: kernels.map((k, i) => ({
        from: [unit.kernels[i].kernel],
        to: [k.kernel],
        relation: 'replace' as const,
      })),
      edits: kernels.filter((k, i) => k !== unit.kernels[i]).length,
      report: `${what}; ${refusals.length} refusal${refusals.length === 1 ? '' : 's'}`,
    };
  },
});

// Double buffering for gemm kernels: the two tile buffers must fit shared memory (a constant check: both tiles
// are compile-time sized; the opt-in limit of the GB10, as the row path already assumes). `off` disables it,
// for measurement and for programs where the barrier saving does not pay.
export interface PipelineParams {
  off?: boolean;
}
// The shipped pipeline rule: double buffering lost every measurement above, so the strategy leaves it off; the
// pass stays (legal, gated, measured), and a later stage that finds shapes where it pays flips this constant.
export const defaultPipelineParams: PipelineParams = { off: true };
export const pipelinePass = definePass<ScheduleUnit, {}, PipelineParams>({
  id: 'tensor.schedule.pipeline',
  version: '1',
  description: 'Double-buffer the gemm tiles where two buffers fit shared memory',
  ir: ScheduleIR,
  adapter: scheduleAdapter,
  writes: { entities: ['kernel', 'member'], relations: [] },
  run: ({ before, params }) => {
    const unit = before.value;
    const optin = 99 * 1024;
    const kernels = unit.kernels.map(k => {
      if (k.mapping !== 'gemm' || !k.tile || params?.off) return k;
      const [BM, BN] = k.tile.block,
        chunk = k.tile.chunk,
        pad = k.tile.pad;
      const bytes = 2 * 4 * (BM * (chunk + pad) + chunk * (BN + pad));
      if (bytes > optin) return k;
      return { ...k, tile: { ...k.tile, doubleBuffer: true } };
    });
    const changed = kernels.filter((k, i) => k !== unit.kernels[i]).length;
    return {
      native: { ...unit, kernels },
      correspondence: kernels.map((k, i) => ({
        from: [unit.kernels[i].kernel],
        to: [k.kernel],
        relation: 'replace' as const,
      })),
      edits: changed,
      report: changed
        ? `double buffering on ${changed} kernel${changed === 1 ? '' : 's'}`
        : params?.off
          ? 'disabled by parameter'
          : 'no kernel double-buffered',
    };
  },
});

export interface ScheduleStep {
  pass: string;
  changed: boolean;
  reason: string;
}
/** Apply one scheduling pass with the order gate. */
export function applySchedulePass<P = unknown>(
  pass: Pass<ScheduleUnit, {}, P>,
  artifact: ReturnType<typeof scheduleArtifact>,
  params?: P,
): { result: PassResult<ScheduleUnit>; step: ScheduleStep } {
  const result = applyNativePassSync(pass, artifact, orderGate, params);
  const report = result.report;
  return {
    result,
    step: {
      pass: pass.id,
      changed: result.changed,
      reason: typeof report === 'string' ? report : typeof report === 'undefined' ? '' : String(report),
    },
  };
}

/** The schedule pipeline as the plain (synchronous) path runs it: plan, fuse, tile, pipeline. */
export function scheduleTixFn(
  fn: Fn,
  options?: { fuse?: boolean; tile?: TileParams; pipeline?: PipelineParams },
): {
  schedule: ReturnType<typeof scheduleArtifact>;
  steps: ScheduleStep[];
  results: PassResult<ScheduleUnit>[];
} {
  const schedule = planArtifact(fn);
  const steps: ScheduleStep[] = [
    { pass: 'tensor.plan-schedule', changed: true, reason: `${fn.statements.length} kernels, one per statement` },
  ];
  const results: PassResult<ScheduleUnit>[] = [];
  let current = schedule;
  if (options?.fuse !== false) {
    const fused = applySchedulePass(fusePass, current);
    results.push(fused.result);
    steps.push(fused.step);
    current = fused.result.artifact;
    const tiled = applySchedulePass(tilePass, current, options?.tile ?? defaultTileParams);
    results.push(tiled.result);
    steps.push(tiled.step);
    current = tiled.result.artifact;
    const piped = applySchedulePass(pipelinePass, current, options?.pipeline ?? defaultPipelineParams);
    results.push(piped.result);
    steps.push(piped.step);
    current = piped.result.artifact;
  }
  return { schedule: current, steps, results };
}
