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
// IRWB-030-I adds two decisions, both recorded in the plan:
//   - term staging: a row-scalar member's reduction can compute its terms block-wide into a buffer and fold them
//     in order afterwards, so a costly term (a division, an exp) is no longer serial (rules S0-S4 below);
//   - the launch gate: with the shape values at launch, a block-mode group with too few rows to fill the machine
//     stays unfused (stage 2's singleton kernels); without values the planner keeps stage 3's behaviour.
import { plain, value, visit, type Affine, type Expr, type Fn, type Statement } from './model.js';

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
  /** Block mode: reductions whose terms the block computes in parallel before one thread folds them in order. */
  terms: TermStaging[];
  /** Why the statements share this kernel, and what changed in the thread mapping. */
  reasons: string[];
}
export interface TermStaging {
  statement: string;
  /** The reduction's position in its statement's pre-order walk (the emitter walks the same way). */
  node: number;
  /** Number of reduction axes flattened into the term buffer (first listed outermost). */
  axes: number;
  reason: string;
}
export interface FusionRefusal {
  statement: string;
  kernel: string;
  reason: string;
}
export interface TermRefusal {
  statement: string;
  node: number;
  reason: string;
}
export interface FusionPlan {
  fn: string;
  groups: FusionGroup[];
  refusals: FusionRefusal[];
  termRefusals: TermRefusal[];
  /** Launch-gate decisions (only with shape values): block-mode groups kept unfused, with the row count. */
  unfused: { statements: string[]; rows: number; reason: string }[];
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

type Reduce = Extract<Expr, { kind: 'reduce' }>;
export interface ReduceNode {
  node: Reduce;
  /** Position in the pre-order walk over the statement's expression (all nodes counted). */
  at: number;
  /** Whether another reduction encloses this one. */
  nested: boolean;
}
/** The reduction nodes of an expression, in the pre-order walk the plan and the emitter share. */
export function reduceNodes(e: Expr): ReduceNode[] {
  const nodes: ReduceNode[] = [];
  let next = 0;
  const walk = (x: Expr, nested: boolean) => {
    const at = next++;
    if (x.kind === 'op') x.args.forEach(a => walk(a, nested));
    else if (x.kind === 'reduce') {
      nodes.push({ node: x, at, nested });
      walk(x.body, true);
    }
  };
  walk(e, false);
  return nodes;
}
const expensive = (e: Expr): boolean => {
  let found = false;
  visit(e, x => {
    if (x.kind === 'op' && (x.op === '/' || x.op === 'exp' || x.op === 'log' || x.op === 'tanh'))
      found = true;
  });
  return found;
};
const singleLoad = (e: Expr): string | undefined => (e.kind === 'load' ? e.name : undefined);

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

/**
 * Term staging, decided from the IR (design S0-S4). `resident` holds the tensors already living in the block's
 * row buffers (staged parameters and buffered members). Returns the staged reductions of `member` and the
 * refusals for the ones that keep the inline fold.
 */
function planTerms(
  member: Statement,
  depth: number,
  resident: Set<string>,
  block: boolean,
): { terms: TermStaging[]; refusals: TermRefusal[] } {
  const terms: TermStaging[] = [],
    refusals: TermRefusal[] = [];
  if (!block) {
    for (const { node, at } of reduceNodes(member.expr))
      refusals.push({
        statement: member.name,
        node: at,
        reason: 'thread mode computes one element per thread, as stage 2 does; nothing to stage',
      });
    return { terms, refusals };
  }
  const rowScalar = member.axes.length === depth;
  for (const { node, at, nested } of reduceNodes(member.expr)) {
    if (!rowScalar) {
      refusals.push({
        statement: member.name,
        node: at,
        reason: 'the member has trailing axes; its terms already run one output element per thread',
      });
      continue;
    }
    if (nested) {
      refusals.push({
        statement: member.name,
        node: at,
        reason: 'nested inside another reduction; its terms run inside the enclosing term',
      });
      continue;
    }
    if (node.axes.some(a => a.extent.kind !== 'dim')) {
      refusals.push({
        statement: member.name,
        node: at,
        reason: 'a reduction axis has split bounds; the term space is ragged, the fold stays inline',
      });
      continue;
    }
    const load = singleLoad(node.body);
    if (load !== undefined && resident.has(load)) {
      refusals.push({
        statement: member.name,
        node: at,
        reason: `its terms are loads of ${load}, already in the row buffer; staging would copy them`,
      });
      continue;
    }
    if (!expensive(node.body)) {
      refusals.push({
        statement: member.name,
        node: at,
        reason: 'its terms are loads and cheap ops; the fold is not the serial cost',
      });
      continue;
    }
    terms.push({
      statement: member.name,
      node: at,
      axes: node.axes.length,
      reason: 'its terms are computed by the block; one thread folds them in the meaning’s order',
    });
  }
  return { terms, refusals };
}
/**
 * Rows below this keep a block-mode group unfused when the shape values at launch say so: one block per row cannot
 * use more blocks than there are rows, so a small grid leaves the machine idle while stage 2's per-statement
 * kernels spread every row phase over the whole GPU. The crossover is measured, not chosen (script 05).
 */
export const blockModeMinRows = 96;

/** The block-domain extent values of a group, or undefined when the shape values do not determine them. */
function rowsOf(fn: Fn, group: { statements: string[]; depth: number }, dims?: Map<string, number>) {
  if (!dims) return undefined;
  const member = [...fn.params, ...fn.statements].find(t => t.name === group.statements[0])!;
  const extents = member.shape.slice(0, group.depth);
  if (!extents.every(a => a.terms.every(([n]) => dims.has(n)))) return undefined;
  return extents.reduce((rows, a) => rows * value(a, dims), 1);
}

export function planFusion(fn: Fn, shapeValues?: Map<string, number>): FusionPlan {
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
  const termRefusals: TermRefusal[] = [];
  let gated: FusionPlan['unfused'] = [];
  const groups = runs.flatMap(({ members, depth, reasons }, g): FusionGroup[] => {
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
    // Term staging (S0-S4). A single-statement group is stage 2's own kernel and never stages.
    const terms: TermStaging[] = [];
    if (!single) {
      const resident = new Set([...staged, ...buffered.map(m => m.name)]);
      for (const m of members) {
        const decided = planTerms(m, depth, resident, block);
        terms.push(...decided.terms);
        termRefusals.push(...decided.refusals);
      }
    } else
      for (const m of members)
        termRefusals.push(
          ...reduceNodes(m.expr).map(({ at }) => ({
            statement: m.name,
            node: at,
            reason: 'a one-statement kernel is stage 2\'s own emitter; it keeps the inline fold',
          })),
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
            ...(staged.size ? [`rows of ${[...staged].join(', ')} are staged in the row buffer`] : []),
            ...terms.map(t => `the terms of ${t.statement}'s reduction are staged: ${t.reason}`),
          ]
        : [
            `one thread per element of [${axes}] computes ${members.map(m => m.name).join(', ')} in registers`,
          ];
    const group: FusionGroup = {
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
    // The launch gate: with the shape values at launch, a block-mode group with too few rows stays unfused.
    if (block && shapeValues) {
      const rows = rowsOf(fn, group, shapeValues);
      if (rows !== undefined && rows < blockModeMinRows) {
        gated.push({
          statements: group.statements,
          rows,
          reason: `${rows} ${rows === 1 ? 'row fills' : 'rows fill'} fewer blocks than the machine runs concurrently; ` +
            `stage 2's kernels spread each row phase over the whole grid (crossover ${blockModeMinRows}, script 05)`,
        });
        return members.map((m, i): FusionGroup => {
          termRefusals.push(
            ...reduceNodes(m.expr).map(({ at }) => ({
              statement: m.name,
              node: at,
              reason: 'the group is unfused at launch; every kernel is stage 2\'s own emitter',
            })),
          );
          return {
            kernel: `k${g}f${i}`,
            statements: [m.name],
            depth: m.axes.length,
            mapping: 'thread',
            stored: [m.name],
            buffered: [],
            staged: [],
            terms: [],
            reasons: [],
          };
        });
      }
    }
    return [group];
  });
  return { fn: fn.name, groups, refusals, termRefusals, unfused: gated };
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
    termRefusals: [],
    unfused: [],
  };
}
