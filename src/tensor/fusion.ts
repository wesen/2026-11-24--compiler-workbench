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
// The block may precompute independent terms. The fold always runs on one thread in the original order.
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
  /** Why the statements share this kernel, and what changed in the thread mapping. */
  reasons: string[];
  /** Reduction selected for cooperative term evaluation in each eligible row scalar. */
  parallelTerms: Record<string, Reduction>;
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

type Reduction = Extract<Expr, { kind: 'reduce' }>;

function reductions(expr: Expr): Reduction[] {
  const result: Reduction[] = [];
  visit(expr, e => {
    if (e.kind === 'reduce') result.push(e);
  });
  return result;
}

// A row-vector contraction with division in its body and a cross-row matrix operand can instead
// launch across its complete output grid. Arithmetic after the fold does not qualify.
function dividedContraction(s: Statement, depth: number): boolean {
  if (s.axes.length <= depth) return false;
  const columns = new Set(s.axes.slice(depth).map(axis => axis.id));
  return reductions(s.expr).some(r => {
    let divides = false,
      crossRow = false;
    const binders = new Set(r.axes.map(a => a.id));
    visit(r.body, e => {
      if (e.kind === 'op' && e.op === '/') divides = true;
      if (
        e.kind === 'load' &&
        e.indices.length === 2 &&
        binders.has(plain(e.indices[0]) ?? '') &&
        columns.has(plain(e.indices[1]) ?? '')
      )
        crossRow = true;
    });
    return divides && crossRow;
  });
}

export function planFusion(fn: Fn): FusionPlan {
  const runs: { members: Statement[]; depth: number; reasons: string[] }[] = [];
  const refusals: FusionRefusal[] = [];
  for (const s of fn.statements) {
    const current = runs.at(-1);
    if (current) {
      const join = joinDepth(s, current.members, current.depth);
      if (join.depth > 0 && dividedContraction(s, join.depth)) {
        join.reason = 'divided cross-row contraction keeps one thread per output across the grid';
      } else if (join.depth > 0) {
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
    const parallelTerms: Record<string, Reduction> = Object.create(null);
    if (block)
      for (const m of members) {
        if (m.axes.length !== depth) continue;
        const rs = reductions(m.expr);
        if (rs.length !== 1) continue;
        const [r] = rs;
        let costly = false;
        visit(r.body, e => {
          if (e.kind === 'op' && ['/', 'sqrt', 'exp', 'log', 'tanh'].includes(e.op)) costly = true;
        });
        if (r.axes.length === 1 && r.axes[0].extent.kind === 'dim' && costly) parallelTerms[m.name] = r;
      }
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
      parallelTerms,
      reasons: [
        ...why,
        ...Object.keys(parallelTerms).map(n => `the block stages ordered terms for ${n}`),
        ...reasons,
      ],
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
      parallelTerms: {},
    })),
    refusals: [],
  };
}
