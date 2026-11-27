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
  /** Block mode: each member's outermost reductions, and whether all threads compute their terms (IRWB-030-D). */
  terms: TermStaging[];
  /** Why the statements share this kernel, and what changed in the thread mapping. */
  reasons: string[];
}
export interface TermStaging {
  statement: string;
  /** Index among the statement's outermost reductions, in the tree walk's order (`outerReductions`). */
  reduction: number;
  staged: boolean;
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
export type Reduce = Extract<Expr, { kind: 'reduce' }>;

/** The reductions of e that are not inside another reduction's body, in the order the tree walk meets them. */
export function outerReductions(e: Expr, out: Reduce[] = []): Reduce[] {
  if (e.kind === 'reduce') out.push(e);
  if (e.kind === 'op') e.args.forEach(a => outerReductions(a, out));
  return out;
}

// IRWB-030-D: which reduction bodies are worth computing in parallel. 'costly' (the default, measured in the
// ticket's M1): a body with an operation that is a multi-instruction sequence on the GPU (division, square root,
// the double-precision exp, log and tanh) or a nested reduction. 'any': every body with an operation. A body that
// is a load or a constant is never staged: thread 0 would read a copy of what it reads now.
export type TermRule = 'costly' | 'any' | 'none';
const multiInstruction = new Set(['/', 'sqrt', 'exp', 'log', 'tanh']);
function termCost(body: Expr): 'costly' | 'cheap' | 'load' {
  let cost: 'costly' | 'cheap' | 'load' = 'load';
  visit(body, e => {
    if (e.kind === 'reduce' || (e.kind === 'op' && multiInstruction.has(e.op))) cost = 'costly';
    else if (e.kind === 'op' && cost === 'load') cost = 'cheap';
  });
  return cost;
}
function stageTerms(r: Reduce, rule: TermRule): { staged: boolean; reason: string } {
  const cost = termCost(r.body);
  if (cost === 'load')
    return { staged: false, reason: 'the term is a load or a constant; staging would only copy it' };
  if (rule === 'none' || (rule === 'costly' && cost === 'cheap'))
    return {
      staged: false,
      reason: 'the term is one single-instruction operation chain; thread 0 computes it in the fold',
    };
  return {
    staged: true,
    reason: 'all threads compute the terms into a term buffer; thread 0 folds them in order',
  };
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

export function planFusion(fn: Fn, options?: { terms?: TermRule }): FusionPlan {
  const rule = options?.terms ?? 'costly';
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
    const terms: TermStaging[] = [];
    if (block)
      for (const m of members)
        outerReductions(m.expr).forEach((r, reduction) =>
          terms.push({
            statement: m.name,
            reduction,
            ...(m.axes.length > depth
              ? { staged: false, reason: 'computed per element by its own thread, as in stage 2' }
              : stageTerms(r, rule)),
          }),
        );
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
            ...terms
              .filter(t => t.staged)
              .map(
                t =>
                  `the terms of ${t.statement}'s reduction ${t.reduction} are computed by all threads; ` +
                  'thread 0 folds them in order',
              ),
            ...(staged.size ? [`rows of ${[...staged].join(', ')} are staged in the row buffer`] : []),
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
      reasons: [...why, ...reasons],
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
      terms: [],
      reasons: [],
    })),
    refusals: [],
  };
}
