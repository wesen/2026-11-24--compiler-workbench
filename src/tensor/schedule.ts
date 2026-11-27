// IRWB-033-E: the schedule IR, a v6 artifact between Tix and the CUDA source. Its value is the Tix function (the
// algorithm) and an ordered list of kernels (the schedule). Every lowering decision is a field of a kernel; the
// passes in schedule-passes.ts set them one step at a time, schedule-eval.ts executes a schedule on the CPU, and
// cuda-source.ts prints one without deciding anything.
import { defineIR } from '../framework/contracts/index.js';
import { defineAdapter, type IREntity, type IRRelation } from '../framework/ir/index.js';
import {
  gate as gateConstants,
  outerReductions,
  type FusionGroup,
  type FusionPlan,
  type Reduce,
} from './fusion.js';
import { TixIR } from './ir.js';
import { plain, visit, type Expr, type Fn, type Statement } from './model.js';

/** The axes of a contraction statement, by which factor of the reduction's body reads them. */
export interface Roles {
  /** Output axes read only by the left factor. */
  rows: string[];
  /** Output axes read only by the right factor. */
  cols: string[];
  /** Output axes read by both factors or by neither: one grid point each. */
  batch: string[];
}
/** One thread per output element; members after the first are registers (stage 2, stage 3's thread mode). */
export interface ThreadKernel {
  kind: 'thread';
  name: string;
  statements: string[];
  stored: string[];
  /** Set by `mark-contractions`: the statement has the contraction form, with these roles. */
  contraction?: Roles;
  reasons: string[];
}
export interface GateRule {
  fullRow: number;
  smallGrid: number;
  heavyLanes: [number, number];
}
/** Stage 3's block mode: one block per point of the first `depth` axes, with 3b's constructs as fields. */
export interface BlockKernel extends Omit<FusionGroup, 'kernel' | 'mapping' | 'gated'> {
  kind: 'block';
  name: string;
  /** Threads per block: caps for rows only, with a contraction operand, and with heavy members. */
  width: { rows: number; contraction: number; heavy: number };
  /** The launch-time choice between block mode and the members one by one, with its constants (`gate` pass). */
  gate?: GateRule;
}
/**
 * One way to run a tiled contraction. One block computes `tile[0]` x `tile[1]` elements of the (row, column)
 * space, one thread a `patch[0]` x `patch[1]` patch of them in registers. With `chunk` > 0 the terms run in
 * chunks of that many, and with `staged` each chunk's factors are first copied to shared memory. Every output
 * still adds its terms one at a time in the meaning's order.
 */
export interface TileConfig {
  tile: [number, number];
  patch: [number, number];
  chunk: number;
  staged: boolean;
  /** Chosen at launch when the kernel would have at least this many blocks. */
  minTiles: number;
}
/** A contraction statement with an ordered list of configurations; the host takes the first whose condition holds, else stage 2's mapping. */
export interface TileKernel {
  kind: 'tile';
  name: string;
  statements: string[];
  stored: string[];
  roles: Roles;
  configs: TileConfig[];
  reasons: string[];
}
export type ScheduleKernel = ThreadKernel | BlockKernel | TileKernel;
export interface Schedule {
  fn: Fn;
  kernels: ScheduleKernel[];
}

// Threads per block in block mode (the measurements are in cuda-source.ts, where stage 3 chose them).
export const blockThreads = { rows: 128, contraction: 64, heavy: 256 };
/** A plan (stage 3b's, or one written by hand) as a schedule; `gated` and the caps become IR fields. */
export function scheduleFromPlan(fn: Fn, plan: FusionPlan): Schedule {
  return { fn, kernels: plan.groups.map(g => kernelOf(g, { terms: true, inPlace: true, gate: g.gated })) };
}
const termReason = /compute the terms of|is written over the row of/;
export function kernelOf(
  g: FusionGroup,
  take: { terms: boolean; inPlace: boolean; gate: boolean },
): ScheduleKernel {
  if (g.mapping === 'thread')
    return { kind: 'thread', name: g.kernel, statements: g.statements, stored: g.stored, reasons: g.reasons };
  const { kernel, mapping: _mapping, gated: _gated, ...rest } = g;
  return {
    ...rest,
    kind: 'block',
    name: kernel,
    terms: take.terms ? g.terms : [],
    heavy: take.terms ? g.heavy : [],
    inPlace: take.inPlace ? g.inPlace : [],
    reasons: g.reasons.filter(
      r => !termReason.test(r) || (r.includes('written over') ? take.inPlace : take.terms),
    ),
    width: { ...blockThreads },
    ...(take.gate && {
      gate: { ...gateConstants, heavyLanes: [...gateConstants.heavyLanes] as [number, number] },
    }),
  };
}

/** The contraction form (design-doc/01): one outermost sum with plain extents whose body is L * R. */
export function contractionOf(s: Statement): { reduction: Reduce; roles: Roles } | { refused: string } {
  const outer = outerReductions(s.expr);
  if (outer.length !== 1) return { refused: `${outer.length} outermost reductions, not one` };
  const [r] = outer;
  if (r.op !== 'sum') return { refused: 'the reduction is not a sum' };
  if (r.axes.some(a => a.extent.kind !== 'dim')) return { refused: 'a reduction axis has a split extent' };
  if (r.body.kind !== 'op' || r.body.op !== '*') return { refused: 'the body is not a product' };
  const reads = r.body.args.map(side => {
    const ids = new Set<string>();
    let inner = false;
    visit(side, e => {
      if (e.kind === 'reduce') inner = true;
      if (e.kind === 'load') e.indices.forEach(a => a.terms.forEach(([n]) => ids.add(n)));
    });
    return inner ? undefined : ids;
  });
  const [left, right] = reads;
  if (!left || !right) return { refused: 'a factor contains a reduction' };
  const out = s.axes.map(a => a.id);
  const roles: Roles = {
    rows: out.filter(a => left.has(a) && !right.has(a)),
    cols: out.filter(a => right.has(a) && !left.has(a)),
    batch: out.filter(a => left.has(a) === right.has(a)),
  };
  if (!roles.rows.length || !roles.cols.length) return { refused: 'no row axis or no column axis' };
  return { reduction: r, roles };
}

/** Threads per block and shared floats of a configuration, and why it cannot be printed (or ''). */
export function configLimits(c: TileConfig) {
  const [tm, tn] = c.tile,
    [rm, rn] = c.patch;
  const threads = (tm / rm) * (tn / rn);
  const shared = c.staged ? c.chunk * (tm + tn) : 0;
  const ints = [tm, tn, rm, rn, c.minTiles].every(n => Number.isSafeInteger(n) && n >= 1);
  const problem = !ints
    ? 'tile, patch and minTiles are positive integers'
    : tm % rm || tn % rn
      ? 'a patch side does not divide its tile side'
      : threads > 1024
        ? 'more than 1,024 threads per block'
        : !Number.isSafeInteger(c.chunk) || c.chunk < 0 || (c.staged && c.chunk < 1)
          ? 'staging needs a positive chunk'
          : shared * 4 > 48 * 1024
            ? "the staged chunk exceeds the block's default shared memory"
            : rm * rn > 64
              ? 'more than 64 accumulators per thread'
              : '';
  return { threads, shared, problem };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// (artifact values are stored with sorted keys, so records are compared field by field)
const sameRoles = (a: Roles, b: Roles) =>
  same(a.rows, b.rows) && same(a.cols, b.cols) && same(a.batch, b.batch);
function loadsOf(e: Expr) {
  const out: Extract<Expr, { kind: 'load' }>[] = [];
  visit(e, x => {
    if (x.kind === 'load') out.push(x);
  });
  return out;
}
/**
 * Structure and legality, re-checked from the embedded function: the kernels partition the statements in order;
 * a value read from another kernel is stored; a tile kernel's roles are the statement's; a configuration is
 * printable; a block kernel's members read each other only at their own block point.
 */
function validate(value: unknown) {
  const s = value as Schedule;
  const fail = (reason: string): never => {
    throw Error('Invalid schedule: ' + reason);
  };
  if (!s || typeof s !== 'object' || !Array.isArray(s.kernels)) fail('no kernel list');
  (TixIR.validate as (v: unknown) => void)({ functions: [s.fn] });
  const order = s.kernels.flatMap(k => k.statements);
  if (
    !same(
      order,
      s.fn.statements.map(x => x.name),
    )
  )
    fail('the kernels do not hold the statements in order');
  if (new Set(s.kernels.map(k => k.name)).size !== s.kernels.length) fail('duplicate kernel name');
  const byName = new Map(s.fn.statements.map(x => [x.name, x]));
  const home = new Map(s.kernels.flatMap(k => k.statements.map(n => [n, k] as const)));
  for (const k of s.kernels) {
    if (!k.statements.length || typeof k.name !== 'string' || !k.name) fail('empty kernel');
    if (k.stored.some(n => !k.statements.includes(n))) fail(`${k.name} stores a statement it does not hold`);
    const members = k.statements.map(n => byName.get(n)!);
    for (const m of members)
      for (const e of loadsOf(m.expr)) {
        const from = home.get(e.name);
        if (from && from !== k && !from.stored.includes(e.name))
          fail(`${m.name} reads ${e.name}, which ${from.name} does not store`);
      }
    if (s.fn.statements.some(x => x.name === s.fn.result) && home.get(s.fn.result) === k)
      if (!k.stored.includes(s.fn.result)) fail('the result is not stored');
    if (k.kind === 'tile') {
      if (members.length !== 1) fail(`${k.name}: a tile kernel holds one statement`);
      const c = contractionOf(members[0]);
      if ('refused' in c) return fail(`${k.name}: ${c.refused}`);
      if (!sameRoles(c.roles, k.roles)) fail(`${k.name}: roles differ from the statement's`);
      if (!k.configs.length) fail(`${k.name}: no configuration`);
      for (const config of k.configs) {
        const { problem } = configLimits(config);
        if (problem) fail(`${k.name}: ${problem}`);
      }
    } else if (k.kind === 'thread') {
      if (k.contraction) {
        const c = contractionOf(members[0]);
        if (members.length !== 1 || 'refused' in c || !sameRoles(c.roles, k.contraction))
          fail(`${k.name}: not the contraction it is marked as`);
      }
      // thread mode: every member has the first one's shape and reads members at its own element
      for (const m of members) {
        if (!same(m.shape, members[0].shape)) fail(`${k.name}: members of different shapes share threads`);
        for (const e of loadsOf(m.expr))
          if (k.statements.includes(e.name) && !e.indices.every((a, p) => plain(a) === m.axes[p].id))
            fail(`${k.name}: ${m.name} reads ${e.name} at another element`);
      }
    } else if (k.kind === 'block') {
      const d = k.depth;
      if (!(d >= 1) || members.some(m => m.axes.length < d)) fail(`${k.name}: block depth`);
      for (const m of members) {
        if (!same(m.shape.slice(0, d), members[0].shape.slice(0, d)))
          fail(`${k.name}: members with different block domains`);
        for (const e of loadsOf(m.expr))
          if (
            (k.statements.includes(e.name) || k.staged.includes(e.name)) &&
            k.statements.includes(e.name) &&
            !e.indices.slice(0, d).every((a, p) => plain(a) === m.axes[p].id)
          )
            fail(`${k.name}: ${m.name} reads ${e.name} outside its block point`);
      }
      for (const p of k.inPlace) {
        const b = byName.get(p.statement)!;
        const after = k.statements.slice(k.statements.indexOf(p.statement) + 1).map(n => byName.get(n)!);
        if (!b || after.some(m => loadsOf(m.expr).some(e => e.name === p.over)))
          fail(`${k.name}: ${p.statement} is written over ${p.over}, which is read later`);
        if (
          loadsOf(b.expr).some(
            e => e.name === p.over && !e.indices.every((a, q) => plain(a) === b.axes[q]?.id),
          )
        )
          fail(`${k.name}: ${p.statement} reads ${p.over} at another element`);
      }
      for (const t of k.terms) {
        const m = byName.get(t.statement);
        if (!m || m.axes.length !== d || !outerReductions(m.expr)[t.reduction])
          fail(`${k.name}: staged terms of ${t.statement}`);
      }
    } else fail('unknown kernel kind');
  }
}

export const ScheduleIR = defineIR<Schedule>({
  id: 'tensor.schedule',
  version: '1',
  description:
    'A Tix function with its kernels: thread, block and tiled mappings and their launch-time choices',
  validate,
  entities: s => s.kernels.map(k => k.name),
});

function* entities(s: Schedule): Generator<IREntity> {
  for (const k of s.kernels) {
    const { name, statements: _statements, ...attributes } = k;
    yield { id: name, kind: 'kernel', attributes: attributes as never };
  }
  for (const x of s.fn.statements) yield { id: 's/' + x.name, kind: 'statement', attributes: {} };
}
function* relations(s: Schedule): Generator<IRRelation> {
  for (const k of s.kernels)
    for (const [order, n] of k.statements.entries())
      yield {
        id: `computes/${k.name}/${n}`,
        from: k.name,
        to: 's/' + n,
        kind: 'computes',
        category: 'containment',
        order,
      };
}
export const scheduleAdapter = defineAdapter<Schedule>({
  id: 'tensor.schedule-adapter',
  version: '1',
  description: 'Kernels and the statements they compute',
  kind: ScheduleIR.id,
  schemaVersion: ScheduleIR.version,
  validate,
  relationKinds: { computes: 'containment' },
  entities,
  relations,
  resolve: (s, id) => [...entities(s)].find(e => e.id === id),
  describe: (_, id) => ({ label: id }),
});
