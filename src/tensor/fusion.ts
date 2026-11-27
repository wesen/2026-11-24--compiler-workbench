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
import { plain, visit, type Affine, type Expr, type Fn, type Statement } from './model.js';

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
  /**
   * Block mode (IRWB-030-E): reductions whose terms all threads of the block compute into a term buffer before
   * one thread folds them in the meaning's order. `reduction` numbers the statement's outermost reductions in
   * preorder (`outerReductions`).
   */
  terms: { statement: string; reduction: number }[];
  /**
   * Block mode (IRWB-030-E): `statement`'s row is stored in the row buffer of `over`, element by element. Each
   * thread reads `over` only at the element it then writes, and nothing reads `over` afterwards.
   */
  inPlace: { statement: string; over: string }[];
  /**
   * Block mode: members with trailing axes and a reduction whose terms would be worth staging (`staging`) but are
   * not, because the member's own row occupies the block. The gate counts the lanes that work on them.
   */
  heavy: string[];
  /** Block mode: the host decides at launch (`gateRule`) between this kernel and the members one by one. */
  gated: boolean;
  /** Why the statements share this kernel, and what changed in the thread mapping. */
  reasons: string[];
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
  /** Reductions of block-mode members whose terms are not staged, with the reason (IRWB-030-E). */
  termRefusals: FusionRefusal[];
}

type Load = Extract<Expr, { kind: 'load' }>;
export type Reduce = Extract<Expr, { kind: 'reduce' }>;
/** The reductions of e that are not inside another reduction, in preorder. */
export function outerReductions(e: Expr): Reduce[] {
  if (e.kind === 'reduce') return [e];
  return e.kind === 'op' ? e.args.flatMap(outerReductions) : [];
}
const same = (a: Affine, b: Affine) => JSON.stringify(a) === JSON.stringify(b);
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

// Which bodies are worth a term pass (IRWB-030-E script 03: row sums over [4096, 1024], five benchmark calls
// each). The pass costs a barrier and a term buffer in the block's shared memory. With one or two
// single-instruction operations per term, one thread's loop was faster (0.136 against 0.154 ms, 0.127 against
// 0.137); with three the two were equal (0.154 against 0.157); with four and eight the term pass was faster
// (0.135 against 0.152, 0.151 against 0.189). With one division, square root, max or min it was faster by 1.5 to
// 2 times, and with exp by 17 times.
export const staging = { cheapOperations: 4 };
/** The body's work for one thread: the number of + - * and negations, or Infinity with anything costlier. */
function work(e: Expr): number {
  if (e.kind === 'reduce') return Infinity;
  if (e.kind !== 'op') return 0;
  return e.args.reduce((n, a) => n + work(a), ['+', '-', '*', 'neg'].includes(e.op) ? 1 : Infinity);
}

// The gate (IRWB-030-E): whether a block-mode group runs fused at launch, as a C++ condition over values the host
// computes. Block mode is slower than stage 2 in two measured regimes (the report has the tables):
//  - Many short rows. A block has a fixed cost of 1 to 3 ns of GPU time, more with staged terms, whatever its
//    row holds, and stage 2 is cheap per element, most of all when its tensors fit the 24 MiB L2 (scripts 05,
//    10, 18 and 19: softmax, softmax with exp inside the sum, a row sum and a row sum of x / 3). With rows of
//    96 or more, fused was at most 0.97 of stage 2 in every measurement. With 64 it lost on the cheapest
//    program at 8,192 to 32,768 rows (1.00 to 1.14), with 48 up to 1.57, with 4 up to 8.4. With at most 1,024
//    rows it was faster whatever their length (at most 0.73; one launch replaces several); at 2,048 rows of 4
//    it lost on one program (1.05 and 1.12 in two sessions).
//  - A heavy member (the plan's `heavy`) with few lanes at work. The lanes are the blocks resident on one SM
//    times the threads that have an element of that member. With 19/24 of the SM's threads or more, fused was
//    faster (attention with the division inside at 19/24: 0.76 to 0.82 of stage 2; narrow-div at 20/24 and
//    24/24: 0.74 to 0.86, scripts 11 and 12). With 46% or less it was slower in six of seven measurements (up
//    to 1.7 times). 19/24 is the lowest measured occupancy at which nothing lost; between is not measured.
export const gate = { fullRow: 96, smallGrid: 1024, heavyLanes: [19, 24] };
export function gateRule(v: { grid: string; longest: string; lanes: string[]; slots: string }): string {
  const rows = `(${v.longest} >= ${gate.fullRow} || ${v.grid} <= ${gate.smallGrid})`;
  const [n, d] = gate.heavyLanes;
  return [rows, ...v.lanes.map(l => `${l} * ${d} >= ${n} * ${v.slots}`)].join(' && ');
}

export interface FusionOptions {
  /**
   * IRWB-033-D: statements that must not be computed in block mode (the schedule's tileable contractions). Such a
   * statement starts its own kernel, and a later statement joins that kernel only if it stays thread mode.
   */
  noBlock?: ReadonlySet<string>;
}
export function planFusion(fn: Fn, options: FusionOptions = {}): FusionPlan {
  const noBlock = options.noBlock ?? new Set<string>();
  const runs: { members: Statement[]; depth: number; reasons: string[] }[] = [];
  const refusals: FusionRefusal[] = [],
    termRefusals: FusionRefusal[] = [];
  for (const s of fn.statements) {
    const current = runs.at(-1);
    if (current && noBlock.has(s.name))
      refusals.push({
        statement: s.name,
        kernel: 'k' + (runs.length - 1),
        reason: 'it is a tileable contraction, which starts its own kernel',
      });
    else if (current) {
      const join = joinDepth(s, current.members, current.depth);
      const locked = current.members.find(m => noBlock.has(m.name));
      if (locked && join.depth > 0 && (join.depth < current.depth || s.axes.length > join.depth))
        Object.assign(join, {
          depth: 0,
          reason: `it would put the tileable contraction ${locked.name} in block mode`,
        });
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
    // Term staging (IRWB-030-E). A member with no trailing axes has one element per block, computed by thread 0
    // while the other threads wait. Its outermost reductions' bodies do not depend on the accumulator, so all
    // threads compute the terms and thread 0 folds them in order. A body that is one load from a row buffer is
    // already a term in shared memory.
    const terms: FusionGroup['terms'] = [],
      heavy = new Set<string>();
    const rowBuffers = new Set([...staged, ...buffered.map(m => m.name)]);
    if (block)
      for (const m of members) {
        const ownRow = (e: Load) =>
          rowBuffers.has(e.name) && e.indices.slice(0, depth).every((a, p) => plain(a) === m.axes[p].id);
        outerReductions(m.expr).forEach((r, reduction) => {
          const refuse = (reason: string) =>
            termRefusals.push({
              statement: m.name,
              kernel: 'k' + g,
              reason: `${r.op} ${reduction}: ${reason}`,
            });
          if (r.body.kind === 'load' && ownRow(r.body)) return;
          const n = work(r.body);
          if (m.axes.length > depth) {
            if (n >= staging.cheapOperations) heavy.add(m.name);
            return refuse('every thread of the block computes elements of the row, so none is idle');
          }
          if (n < staging.cheapOperations)
            return refuse(
              `the body is ${n} single-instruction operation${n === 1 ? '' : 's'}; below ${staging.cheapOperations} one thread's loop is faster`,
            );
          terms.push({ statement: m.name, reduction });
        });
      }
    // Writing a member over the row it is computed from (IRWB-030-E script 08: attention with the division inside
    // 1.41 to 1.15 ms, mlp 0.727 to 0.628, because more blocks fit in an SM's shared memory). B takes A's buffer
    // when both rows have the same extents, every read of A in B is at B's own element, and no later member
    // reads A. A may be a staged row or an earlier member, itself possibly in place.
    const inPlace: FusionGroup['inPlace'] = [];
    if (block)
      members.forEach((b, at) => {
        if (b.axes.length === depth || !rowBuffers.has(b.name)) return;
        const own = (e: Load) =>
          e.indices.length === b.axes.length && e.indices.every((a, p) => plain(a) === b.axes[p].id);
        const over = [...rowBuffers].find(a => {
          const reads = loads(b).filter(e => e.name === a);
          const rest = tensors.get(a)!.shape.slice(depth);
          return (
            a !== b.name &&
            reads.length > 0 &&
            reads.every(own) &&
            rest.length === b.shape.length - depth &&
            rest.every((d, p) => same(d, b.shape[depth + p])) &&
            !members.slice(at + 1).some(m => loads(m).some(e => e.name === a))
          );
        });
        if (over) inPlace.push({ statement: b.name, over });
      });
    const axes = members[0].shape.slice(0, depth).map(text).join(', ');
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
            ...inPlace.map(p => `${p.statement} is written over the row of ${p.over}`),
            ...terms.map(
              t =>
                `all threads compute the terms of ${t.statement}'s reduction ${t.reduction}; thread 0 folds them in order`,
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
      terms,
      inPlace,
      heavy: [...heavy],
      gated: block,
      reasons: [...why, ...reasons],
    };
  });
  return { fn: fn.name, groups, refusals, termRefusals };
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
      terms: [],
      inPlace: [],
      heavy: [],
      gated: false,
      reasons: [],
    })),
    refusals: [],
    termRefusals: [],
  };
}
