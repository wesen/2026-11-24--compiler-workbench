// IRWB-029-D: which statements of a Tix function can share a CUDA kernel without changing any result bit, decided
// from the Tix IR alone, before code generation (design-doc/01 in the ticket).
//
// A group is a contiguous run of statements whose first `depth` axes have equal extents (the block domain). A
// statement joins the current group when it reads a member, and every read of a member has, in each of the first
// `depth` positions, exactly the reader's own axis there. Each block-domain point then needs only its own slice of
// every member, so the group can compute its members in order, point by point:
//   - thread mode (every member has rank `depth`): one thread per point; a member is a register;
//   - block mode (some member has trailing axes): one block per point; a member's row lives in a row buffer, a
//     member with no trailing axes is computed by thread 0, and `__syncthreads()` separates the members.
// Every element is still computed by one thread with stage 2's scalar code, so its evaluation order is unchanged.
//
// IRWB-030-H adds two decisions to the same plan, both made from the Tix IR:
//   - a row-scalar member's reduction stages its terms (`terms`): the block computes every term in parallel into
//     the row buffer and one thread folds them in the meaning's order, so a costly term is not computed serially by
//     thread 0. `stageTerms` prices a term against a shared store, a barrier share and a shared load;
//   - `fusionGate` then decides, with the launch's shape values, whether the program keeps this plan or falls back
//     to stage 2's one kernel per statement, when block mode would leave a warp's lanes idle.
import {
  plain,
  value,
  width,
  visit,
  type Affine,
  type Axis,
  type Extent,
  type Expr,
  type Fn,
  type Op,
  type Statement,
} from './model.js';

export interface FusionGroup {
  kernel: string;
  /** Member statements, in source order. */
  statements: string[];
  /** Number of leading axes shared by the members (the block domain). */
  depth: number;
  mapping: 'thread' | 'block';
  /** Members written to global memory: the result, those read by a later kernel, and every singleton. */
  stored: string[];
  /** Block mode: members read by a later member, kept in a row buffer. */
  buffered: string[];
  /** Block mode: other tensors whose block-domain rows are copied to a row buffer before the members run. */
  staged: string[];
  /** Why the statements share this kernel, and what changed in the thread mapping. */
  reasons: string[];
  /** Block mode: reductions whose terms the block computes in parallel for one thread to fold. */
  terms: StagedTerms[];
  /** Block mode: reductions whose terms stay in one thread's loop, and why. */
  serial: SerialTerms[];
}
/** A reduction whose terms the whole block computes into the row buffer, folded in order by one thread. */
export interface StagedTerms {
  member: string;
  /** Index among the member's top-level reductions, in expression order. */
  reduction: number;
  reason: string;
}
/** A reduction whose terms stay in the loop of the thread that folds them, with the reason it was refused. */
export interface SerialTerms {
  member: string;
  reduction: number;
  reason: string;
}
export interface FusionRefusal {
  statement: string;
  kernel: string;
  reason: string;
}
export interface FusionPlan {
  fn: string;
  groups: FusionGroup[];
  refusals: FusionRefusal[];
}

type Load = Extract<Expr, { kind: 'load' }>;
type Reduce = Extract<Expr, { kind: 'reduce' }>;
const same = (a: Affine, b: Affine) => JSON.stringify(a) === JSON.stringify(b);

/** The member's reductions that are not inside another reduction, in expression order (first listed first). */
export function topLevelReductions(e: Expr): Reduce[] {
  const out: Reduce[] = [];
  const walk = (x: Expr) => {
    if (x.kind === 'reduce') out.push(x);
    else if (x.kind === 'op') x.args.forEach(walk);
  };
  walk(e);
  return out;
}

/** The number of terms of a reduction whose axes are plain extents, as an expression over the shape values. */
export function termCount(r: Reduce, dim: (a: Affine) => string): string {
  return r.axes.length > 1
    ? `(${r.axes.map(a => dim(a.extent.dim)).join(' * ')})`
    : r.axes.map(a => dim(a.extent.dim))[0];
}

// Per-term prices for staging a row reduction's terms (IRWB-030-H script 04: staged against serial for the same
// program, at the brief's row length of 1024). A staged term costs one store into the row buffer, its share of a
// barrier and one load in the fold; a body that only loads a row buffer or multiplies stays in the loop, and a
// body whose term is a division, a square root, a double transcendental or a global load moves out of it.
const costPerTerm: Partial<Record<Op, string>> = {
  '/': 'a division',
  sqrt: 'a square root',
  exp: 'a double exp',
  log: 'a double log',
  tanh: 'a double tanh',
};
const priced = Object.keys(costPerTerm) as Op[];

/** Whether a row reduction's terms are worth computing outside the folding thread, and why. */
export function stageTerms(body: Expr, local: (name: string) => boolean): { stage: boolean; reason: string } {
  let price: string | undefined;
  visit(body, e => {
    if (price) return;
    if (e.kind === 'op' && priced.includes(e.op)) price = `every term has ${costPerTerm[e.op]}`;
    else if (e.kind === 'load' && !local(e.name)) price = `every term reads ${e.name} from global memory`;
  });
  return price
    ? { stage: true, reason: `${price}, so the block computes the terms and thread 0 folds them` }
    : {
        stage: false,
        reason:
          'a term is a row-buffer load or an arithmetic step, no dearer than the store and load staging it would add',
      };
}
function loads(s: Statement): Load[] {
  const out: Load[] = [];
  visit(s.expr, e => {
    if (e.kind === 'load') out.push(e);
  });
  return out;
}
const text = (a: Affine) =>
  [
    ...a.terms.map(([n, k]) => (k === 1 ? n : `${k}*${n}`)),
    ...(a.constant || !a.terms.length ? [a.constant] : []),
  ].join(' + ');

/** The deepest block domain s can share with the group's members, or 0 with the reason it cannot join. */
function joinDepth(s: Statement, members: Statement[], depth: number): { depth: number; reason: string } {
  const names = new Set(members.map(m => m.name));
  const reads = loads(s).filter(e => names.has(e.name));
  if (!reads.length) return { depth: 0, reason: 'reads no tensor of the kernel (no horizontal fusion)' };
  let k = Math.min(depth, s.axes.length),
    reason = `it has ${s.axes.length} ${s.axes.length === 1 ? 'axis' : 'axes'}`;
  for (let p = 0; p < k; p++)
    if (!same(s.shape[p], members[0].shape[p])) {
      [k, reason] = [
        p,
        `its axis ${p} has extent ${text(s.shape[p])}, the kernel's ${text(members[0].shape[p])}`,
      ];
      break;
    }
  for (const r of reads)
    for (let p = 0; p < k; p++)
      if (plain(r.indices[p]) !== s.axes[p].id) {
        const at = text(r.indices[p]);
        [k, reason] = [p, `reads ${r.name} at index ${at} in position ${p}, not its own axis there`];
        break;
      }
  return { depth: k, reason };
}

export function planFusion(fn: Fn): FusionPlan {
  const runs: { members: Statement[]; depth: number; reasons: string[] }[] = [];
  const refusals: FusionRefusal[] = [];
  for (const s of fn.statements) {
    const current = runs.at(-1);
    if (current) {
      const join = joinDepth(s, current.members, current.depth);
      if (join.depth > 0) {
        if (join.depth < current.depth)
          current.reasons.push(
            `${s.name} narrows the block domain to ${join.depth} ${join.depth === 1 ? 'axis' : 'axes'}: ${join.reason}`,
          );
        current.members.push(s);
        current.depth = join.depth;
        continue;
      }
      refusals.push({ statement: s.name, kernel: 'k' + (runs.length - 1), reason: join.reason });
    }
    runs.push({ members: [s], depth: s.axes.length, reasons: [] });
  }
  const readers = new Map<string, number[]>();
  runs.forEach((run, g) =>
    run.members.forEach(s => loads(s).forEach(e => readers.set(e.name, [...(readers.get(e.name) ?? []), g]))),
  );
  const groups = runs.map(({ members, depth, reasons }, g): FusionGroup => {
    const names = new Set(members.map(m => m.name));
    const single = members.length === 1;
    const stored = members
      .filter(m => single || m.name === fn.result || (readers.get(m.name) ?? []).some(r => r > g))
      .map(m => m.name);
    const block = members.some(m => m.axes.length > depth);
    const buffered = block
      ? members.filter((m, i) => members.slice(i + 1).some(r => loads(r).some(e => e.name === m.name)))
      : [];
    const staged = new Set<string>();
    const tensors = new Map([...fn.params, ...fn.statements].map(t => [t.name, t]));
    if (block)
      for (const m of members)
        for (const e of loads(m)) {
          const t = tensors.get(e.name)!;
          if (names.has(e.name) || t.shape.length <= depth) continue;
          const rows = members[0].shape.slice(0, depth);
          if (rows.every((d, p) => same(d, t.shape[p]) && plain(e.indices[p]) === m.axes[p].id))
            staged.add(e.name);
        }
    const axes = members[0].shape.slice(0, depth).map(text).join(', ');
    // IRWB-030-H: which of this kernel's row reductions stage their terms, and why the others do not.
    const terms: StagedTerms[] = [],
      serial: SerialTerms[] = [];
    const local = (name: string) => names.has(name) || staged.has(name);
    if (block)
      for (const m of members)
        topLevelReductions(m.expr).forEach((r, reduction) => {
          if (m.axes.length > depth)
            return void serial.push({
              member: m.name,
              reduction,
              reason: `${m.name} has trailing axes: every element folds its own reduction in its own thread, so no term can be shared`,
            });
          if (r.axes.some(a => a.extent.kind !== 'dim'))
            return void serial.push({
              member: m.name,
              reduction,
              reason:
                'a split (blocks or tail) bound sizes the terms per outer index; the row buffer is sized from the shape values alone',
            });
          const price = stageTerms(r.body, local);
          (price.stage ? terms : serial).push({ member: m.name, reduction, reason: price.reason });
        });
    const why = single
      ? []
      : block
        ? [
            `one block per point of [${axes}] instead of one thread per element; the members run in order, ` +
              'separated by barriers, each element by one thread',
            ...members
              .filter(m => m.axes.length === depth)
              .map(m => `thread 0 computes ${m.name} (one element per row) in the meaning's order`),
            ...(staged.size ? [`rows of ${[...staged].join(', ')} are staged in the row buffer`] : []),
            ...terms.map(
              t =>
                `the block computes ${t.member}'s reduction ${t.reduction} terms in parallel, thread 0 folds them in order`,
            ),
            ...serial.map(
              t => `${t.member}'s reduction ${t.reduction} keeps the folding thread's loop: ${t.reason}`,
            ),
          ]
        : [
            `one thread per element of [${axes}] computes ${members.map(m => m.name).join(', ')} in registers`,
          ];
    return {
      kernel: 'k' + g,
      statements: members.map(m => m.name),
      depth,
      mapping: block ? 'block' : 'thread',
      stored,
      buffered: buffered.map(m => m.name),
      staged: [...staged],
      reasons: [...why, ...reasons],
      terms,
      serial,
    };
  });
  return { fn: fn.name, groups, refusals };
}

/** Stage 2's plan: one thread-mode kernel per statement. */
export function unfusedPlan(fn: Fn): FusionPlan {
  return {
    fn: fn.name,
    groups: fn.statements.map((s, g) => ({
      kernel: 'k' + g,
      statements: [s.name],
      depth: s.axes.length,
      mapping: 'thread',
      stored: [s.name],
      buffered: [],
      staged: [],
      reasons: [],
      terms: [],
      serial: [],
    })),
    refusals: [],
  };
}

/** One warp: the lane granularity a block-mode kernel's row loop pays for. */
export const warpSize = 32;

/** A block-mode group the gate keeps on stage 2's lowering, with the length it saw. */
export interface GateRefusal {
  kernel: string;
  row: number;
  reason: string;
}
export interface GateDecision {
  fuse: boolean;
  refusals: GateRefusal[];
}

/** The extent value of an axis, with the shape symbols bound to their launch values. */
function extentValue(e: Extent, dims: ReadonlyMap<string, number>): number {
  const n = value(e.dim, dims);
  // A tail block covers at most `width` steps; the gate only needs the longest row.
  if (e.kind === 'blocks') return e.rounding === 'ceil' ? Math.ceil(n / width) : Math.floor(n / width);
  if (e.kind === 'tail') return Math.min(width, n);
  return n;
}

/** The longest row a block-mode kernel covers: its longest member row or staged row. */
export function groupRow(group: FusionGroup, fn: Fn, dims: ReadonlyMap<string, number>): number {
  const tensors = new Map([...fn.params, ...fn.statements].map(t => [t.name, t]));
  const length = (shape: Affine[]) => shape.slice(group.depth).reduce((n, d) => n * value(d, dims), 1);
  const rows = group.statements.map(name => {
    const s = tensors.get(name) as Statement;
    return s.axes.slice(group.depth).reduce((n, a) => n * extentValue(a.extent, dims), 1);
  });
  return Math.max(1, ...rows, ...group.staged.map(name => length(tensors.get(name)!.shape)));
}

// IRWB-030-H: the profitability half of fusion, decided with the launch's shape values (brief: "keeps a program or
// a group unfused ... when fusing would be slower"). Block mode covers a row of L elements with the block's threads,
// so it pays for ceil(L/32)*32 lane slots per pass; below one warp, at least half the lanes are idle on every
// parallel phase while stage 2's flattened kernels keep them busy (script 03: fused loses at L = 8 by 2.1-2.6x and
// at L = 16 by up to 9%, and wins by 1.76x from L = 32 on). It only ever chooses between the two exact lowerings.
export function fusionGate(plan: FusionPlan, fn: Fn, dims: ReadonlyMap<string, number>): GateDecision {
  const refusals: GateRefusal[] = [];
  for (const group of plan.groups) {
    if (group.mapping !== 'block') continue;
    const row = groupRow(group, fn, dims);
    if (row < warpSize)
      refusals.push({
        kernel: group.kernel,
        row,
        reason: `its longest row is ${row} elements, below one warp of ${warpSize}: block mode leaves ${warpSize - row} of ${warpSize} lanes idle, where stage 2's flattened kernels do not`,
      });
  }
  return { fuse: refusals.length === 0, refusals };
}
