// IRWB-029-D: which statements of a Tix function can share a CUDA kernel without changing any result bit, decided
// from the Tix IR alone, before code generation (design-doc/01 in that ticket).
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
// IRWB-030-J adds two decisions on top of the legal groups, both recorded in the plan with their reasons:
//   - which reductions of a row-scalar member get parallel terms (the block computes each term, thread 0 folds
//     them in the meaning's order; `termRefusals` says why the others keep the serial fold);
//   - which block-mode groups are left unfused because the launch's shape values say fusion would be slower
//     (`declined`); without shape values every legal group is fused.
import {
  plain,
  value,
  visit,
  type Affine,
  type Expr,
  type Fn,
  type Statement,
  type Tensor,
} from './model.js';

export interface StagedTerms {
  /** The member whose reduction is staged (rank `depth`, block mode). */
  member: string;
  /** The reduction's ordinal among the member's reductions, in pre-order. */
  index: number;
  op: 'sum' | 'max';
  /** The reduction's binder ids, outermost first. */
  axes: string[];
  reason: string;
}
export interface TermRefusal {
  member: string;
  reason: string;
}
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
  /** Block mode: the block's thread cap, from `blockThreads` (IRWB-029-D diary step 4). */
  threadCap: number;
  /** Block mode: reductions of row-scalar members whose terms the block computes in parallel. */
  terms: StagedTerms[];
  /** Reductions considered for parallel terms and refused, with the reason. */
  termRefusals: TermRefusal[];
  /** Why the statements share this kernel, and what changed in the thread mapping. */
  reasons: string[];
}
export interface FusionRefusal {
  statement: string;
  kernel: string;
  reason: string;
}
export interface FusionDecline {
  /** The group's statements, which keep stage 2's one-kernel-each lowering. */
  statements: string[];
  reason: string;
}
export interface FusionPlan {
  fn: string;
  groups: FusionGroup[];
  refusals: FusionRefusal[];
  /** Groups left unfused by the profitability rule; empty without shape values (IRWB-030-J). */
  declined: FusionDecline[];
}

/** Threads per block in block mode, chosen by measurement (IRWB-029-D diary step 4, caps 64, 128 and 256 on
 * softmax, layernorm, attention and mlp): 64 when a member's reduction reads a tensor from global memory (a
 * contraction operand: attention's k and v, mlp's w and v), 128 otherwise (rows only: softmax, layernorm). */
export const blockThreads = { rows: 128, contraction: 64 };

/** A block-mode group is left unfused when its points x threads stay below this at the launch's shape values and
 * its longest row exceeds the thread cap. Set by IRWB-030-J script 04 (the decline sweep): the least points x
 * threads at which no measured family lost to stage 2, kept at or below mlp's 1024 x 64 = 65 536, where fusion
 * is measured faster. Below it, one block per row cannot fill the machine and the elementwise phases slow down
 * by the shortfall. */
export const fuseThreads = 32768;

/** The host's threads-per-block formula: the shortest warp multiple covering the longest row, up to the cap. */
export const blockThreadsFor = (longest: number, cap: number) => Math.min(cap, Math.ceil(longest / 32) * 32);

type Load = Extract<Expr, { kind: 'load' }>;
type Reduce = Extract<Expr, { kind: 'reduce' }>;
const same = (a: Affine, b: Affine) => JSON.stringify(a) === JSON.stringify(b);
function loads(s: Statement): Load[] {
  const out: Load[] = [];
  visit(s.expr, e => {
    if (e.kind === 'load') out.push(e);
  });
  return out;
}
function reduces(s: Statement): Reduce[] {
  const out: Reduce[] = [];
  visit(s.expr, e => {
    if (e.kind === 'reduce') out.push(e);
  });
  return out;
}
const text = (a: Affine) =>
  [
    ...a.terms.map(([n, k]) => (k === 1 ? n : `${k}*${n}`)),
    ...(a.constant || !a.terms.length ? [a.constant] : []),
  ].join(' + ');
const name = (r: Reduce) => `${r.op}(${r.axes.map(a => a.id).join(', ')})`;

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

/** Does any reduction of a member read a tensor that is not in a row buffer (from global memory)? */
function readsGlobalInReduction(m: Statement, rowBuffers: string[]): boolean {
  const buffered = new Set(rowBuffers);
  const walk = (e: Expr, inReduction: boolean): boolean =>
    e.kind === 'load'
      ? inReduction && !buffered.has(e.name)
      : e.kind === 'op'
        ? e.args.some(a => walk(a, inReduction))
        : e.kind === 'reduce' && walk(e.body, true);
  return walk(m.expr, false);
}

/** Rows of other tensors the block copies before the members run (a tensor whose leading extents equal the block
 * domain's, read at the block indices). The checker unifies extents only for plain source occurrences, so this
 * compares the extents itself. */
function stagedSet(members: Statement[], depth: number, tensors: Map<string, Tensor>): string[] {
  const names = new Set(members.map(m => m.name));
  const staged = new Set<string>();
  for (const m of members)
    for (const e of loads(m)) {
      const t = tensors.get(e.name)!;
      if (names.has(e.name) || t.shape.length <= depth) continue;
      const rows = members[0].shape.slice(0, depth);
      if (rows.every((d, p) => same(d, t.shape[p]) && plain(e.indices[p]) === m.axes[p].id))
        staged.add(e.name);
    }
  return [...staged];
}

/** The body is more than one load: an operation, a call, or a nested reduction rounds per term. */
function costly(body: Expr): boolean {
  let found = false;
  visit(body, e => {
    if (e.kind === 'op' || e.kind === 'reduce') found = true;
  });
  return found;
}

/** Which of a block-mode group's reductions get parallel terms (IRWB-030-J design): a reduction of a row-scalar
 * member, with plain `dim` extents and a body that computes something per term. Everything else is refused with a
 * reason, and keeps stage 3's serial fold. */
function termPlan(members: Statement[], depth: number): { terms: StagedTerms[]; refusals: TermRefusal[] } {
  const terms: StagedTerms[] = [];
  const refusals: TermRefusal[] = [];
  for (const m of members) {
    const all = reduces(m);
    if (!all.length) continue;
    if (m.axes.length > depth) {
      refusals.push({
        member: m.name,
        reason: `its elements are already spread over the block's threads; staging ${name(all[0])} would fold one element at a time behind a barrier per element`,
      });
      continue;
    }
    for (const [index, r] of all.entries()) {
      const generated = r.axes.some(a => a.extent.kind !== 'dim');
      if (generated) {
        refusals.push({
          member: m.name,
          reason: `${name(r)} has a bound generated by split-sum, so its term space is not rectangular`,
        });
        continue;
      }
      if (!costly(r.body)) {
        refusals.push({
          member: m.name,
          reason: `${name(r)}'s body is a single load, so the fold is the only serial work; staging would add a terms buffer and two barriers without removing any`,
        });
        continue;
      }
      terms.push({
        member: m.name,
        index,
        op: r.op,
        axes: r.axes.map(a => a.id),
        reason: `${name(r)}'s body rounds a value per term, which thread 0 would otherwise compute serially inside the fold`,
      });
    }
  }
  return { terms, refusals };
}

/** The reduction's term count at these shape values (all `dim` extents), each factor clamped at 0. */
const termCount = (r: Reduce, shapes: Map<string, number>) =>
  r.axes.reduce((n, a) => n * Math.max(0, value(a.extent.dim, shapes)), 1);
const rowLength = (t: Tensor, depth: number, shapes: Map<string, number>) =>
  t.shape.slice(depth).reduce((n, a) => n * Math.max(0, value(a, shapes)), 1);

/** Why the group should keep stage 2's kernels at these shape values, or undefined to fuse (IRWB-030-J): fusion
 * loses when the row exceeds the thread cap (unfused would run points x row threads per statement) and the block
 * grid cannot fill the machine (points x threads below the measured `fuseThreads`). */
function declineReason(
  members: Statement[],
  depth: number,
  tensors: Map<string, Tensor>,
  shapes: Map<string, number>,
  staged: string[],
  buffered: string[],
  terms: StagedTerms[],
): string | undefined {
  const points = members[0].shape.slice(0, depth).reduce((n, a) => n * Math.max(0, value(a, shapes)), 1);
  if (points === 0) return undefined; // nothing runs either way
  const rows = [...staged, ...members.map(m => m.name)];
  let longest = rows.reduce((n, t) => Math.max(n, rowLength(tensors.get(t)!, depth, shapes)), 1);
  for (const t of terms)
    longest = Math.max(longest, termCount(reduces(tensors.get(t.member) as Statement)[t.index], shapes));
  const cap = members.some(m => readsGlobalInReduction(m, [...staged, ...buffered]))
    ? blockThreads.contraction
    : blockThreads.rows;
  const threads = blockThreadsFor(longest, cap);
  if (longest <= cap) return undefined; // fused already runs at least as many threads as unfused
  if (points * threads >= fuseThreads) return undefined;
  return `${points} points x ${threads} threads (${Math.round((points * threads) / 737.28) / 100}% of the 48 SMs' 73 728 threads) cannot fill the machine, and the ${longest}-long row exceeds the ${cap}-thread cap; stage 2's per-statement kernels run ${points * longest} threads`;
}

export function planFusion(fn: Fn, shapes?: Map<string, number>): FusionPlan {
  const tensors = new Map([...fn.params, ...fn.statements].map(t => [t.name, t]));
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
  // IRWB-030-J: leave a block-mode group unfused when the launch's shape values say fusing would be slower.
  const declined: FusionDecline[] = [];
  const kept: typeof runs = [];
  for (const run of runs) {
    const block = run.members.length > 1 && run.members.some(m => m.axes.length > run.depth);
    const reason =
      block && shapes
        ? declineReason(
            run.members,
            run.depth,
            tensors,
            shapes,
            stagedSet(run.members, run.depth, tensors),
            run.members
              .filter((m, i) => run.members.slice(i + 1).some(r => loads(r).some(e => e.name === m.name)))
              .map(m => m.name),
            termPlan(run.members, run.depth).terms,
          )
        : undefined;
    if (reason) {
      declined.push({ statements: run.members.map(m => m.name), reason });
      for (const m of run.members) kept.push({ members: [m], depth: m.axes.length, reasons: [] });
    } else kept.push(run);
  }
  const readers = new Map<string, number[]>();
  kept.forEach((run, g) =>
    run.members.forEach(s => loads(s).forEach(e => readers.set(e.name, [...(readers.get(e.name) ?? []), g]))),
  );
  const groups = kept.map(({ members, depth, reasons }, g): FusionGroup => {
    const names = new Set(members.map(m => m.name));
    const single = members.length === 1;
    const stored = members
      .filter(m => single || m.name === fn.result || (readers.get(m.name) ?? []).some(r => r > g))
      .map(m => m.name);
    const block = members.some(m => m.axes.length > depth);
    const buffered = block
      ? members.filter((m, i) => members.slice(i + 1).some(r => loads(r).some(e => e.name === m.name)))
      : [];
    const staged = block ? stagedSet(members, depth, tensors) : [];
    const planned = block
      ? termPlan(members, depth)
      : { terms: [] as StagedTerms[], refusals: [] as TermRefusal[] };
    const { terms, refusals: termRefusals } = planned;
    const threadCap = block
      ? members.some(m => readsGlobalInReduction(m, [...staged, ...buffered.map(m => m.name)]))
        ? blockThreads.contraction
        : blockThreads.rows
      : blockThreads.rows;
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
            ...(staged.length ? [`rows of ${[...staged].join(', ')} are staged in the row buffer`] : []),
            ...terms.map(
              t =>
                `${t.member}'s ${t.axes.join(', ')}: the block computes the terms, thread 0 folds them in the meaning's order (${t.reason})`,
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
      staged,
      threadCap,
      terms,
      termRefusals,
      reasons: [...why, ...reasons],
    };
  });
  return { fn: fn.name, groups, refusals, declined };
}

/** Stage 2's plan: one thread-mode kernel per statement. */
export function unfusedPlan(fn: Fn): FusionPlan {
  return {
    fn: fn.name,
    groups: fn.statements.map((s, g) => ({
      kernel: 'k' + g,
      statements: [s.name],
      depth: s.axes.length,
      mapping: 'thread' as const,
      stored: [s.name],
      buffered: [],
      staged: [],
      threadCap: blockThreads.rows,
      terms: [],
      termRefusals: [],
      reasons: [],
    })),
    refusals: [],
    declined: [],
  };
}
