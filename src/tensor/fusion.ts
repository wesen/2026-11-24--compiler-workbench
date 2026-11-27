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
import {
  plain,
  value,
  visit,
  width,
  type Affine,
  type Expr,
  type Extent,
  type Fn,
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
 * Term staging, decided from the IR. S0: only row-scalar members of block-mode groups (a row member's terms
 * already run one output element per thread; thread mode is stage 2's mapping). S3: not nested inside another
 * reduction (cooperation would need a barrier per enclosing term). S4: every axis extent has kind dim (split
 * bounds make the term space ragged). S1: the body is not a single load (measured, script 03). `resident` holds
 * the tensors already living in the block's row buffers (staged parameters and buffered members). Returns the
 * staged reductions of `member` and the refusals for the ones that keep the inline fold.
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
    if (load !== undefined) {
      // Measured (script 03): staging a pure copy of a row buffer is 3% slower, and staging single global loads
      // is neutral; every body that computes anything staged 1.1-2.8 times faster, even through the scratch
      // fallback. So the terms are staged unless computing a term is just addressing an existing value.
      refusals.push({
        statement: member.name,
        node: at,
        reason: resident.has(load)
          ? `its terms are loads of ${load}, already in the row buffer; staging would copy them`
          : `its terms are single loads of ${load} from global memory; staging them measured no win`,
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
 * The launch gate (measured, script 02): a block-mode group pays for itself at small row counts only when one of
 * its members folds a serial chain as long as the row. Stage 2's own row-scalar kernel then runs that fold on one
 * thread per row over uncoalesced global loads, and the fused kernel's staged, shared-memory fold beats it at any
 * row count (softmax and layernorm: fused 2-3 times faster from 1 row to 4096). When no member folds the row —
 * the group's work is its row phase, heavy elementwise work per element — one block per row confines that phase
 * to blockDim threads while stage 2 spreads it over the grid: measured 9.6 times slower at one row, parity at
 * about 32 rows, ahead from 64 rows on, with or without staged rows (script 02, C = 1024, 4096, 16384). So a
 * block-mode group with fewer than 64 rows and no row-length fold stays unfused: stage 2's kernels, exact by
 * stage 2's own check, and never slower than the fused alternative.
 */
export const blockModeMinRows = 64;

/** The block-domain extent values of a group, or undefined when the shape values do not determine them. */
function rowsOf(fn: Fn, group: { statements: string[]; depth: number }, dims?: Map<string, number>) {
  if (!dims) return undefined;
  const member = [...fn.params, ...fn.statements].find(t => t.name === group.statements[0])!;
  const extents = member.shape.slice(0, group.depth);
  if (!extents.every(a => a.terms.every(([n]) => dims.has(n)))) return undefined;
  return extents.reduce((rows, a) => rows * value(a, dims), 1);
}

/** The longest member row and the longest serial fold of a run, in elements, or undefined when undeterminable. */
function rowAndFoldOf(run: { members: Statement[]; depth: number }, dims: Map<string, number>) {
  const extentCount = (e: Extent): number =>
    e.kind === 'dim'
      ? value(e.dim, dims)
      : e.kind === 'blocks'
        ? Math[e.rounding](value(e.dim, dims) / width)
        : width;
  let row = 0,
    fold = 0;
  for (const m of run.members) {
    if (m.shape.slice(run.depth).some(a => !a.terms.every(([n]) => dims.has(n)))) return undefined;
    row = Math.max(
      row,
      m.shape.slice(run.depth).reduce((n, a) => n * value(a, dims), 1),
    );
    for (const { node } of reduceNodes(m.expr)) {
      if (node.axes.some(a => !a.extent.dim.terms.every(([n]) => dims.has(n)))) return undefined;
      fold = Math.max(
        fold,
        node.axes.reduce((n, a) => n * extentCount(a.extent), 1),
      );
    }
  }
  return { row, fold };
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
            reason: "a one-statement kernel is stage 2's own emitter; it keeps the inline fold",
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
    // The launch gate: with the shape values at launch, a block-mode group whose work is its row phase and whose
    // rows cannot yet fill the machine stays unfused. A member that folds the whole row keeps the group fused.
    if (block && shapeValues) {
      const rows = rowsOf(fn, group, shapeValues);
      const bounds = rows === undefined ? undefined : rowAndFoldOf({ members, depth }, shapeValues);
      if (rows !== undefined && bounds !== undefined && rows < blockModeMinRows && bounds.fold < bounds.row) {
        gated.push({
          statements: group.statements,
          rows,
          reason:
            `${rows} ${rows === 1 ? 'row' : 'rows'} with no row-length fold: the row phase runs on ` +
            `${bounds.row} elements per block while stage 2 spreads it over the whole grid ` +
            `(crossover ${blockModeMinRows} rows, script 02)`,
        });
        return members.map((m, i): FusionGroup => {
          termRefusals.push(
            ...reduceNodes(m.expr).map(({ at }) => ({
              statement: m.name,
              node: at,
              reason: "the group is unfused at launch; every kernel is stage 2's own emitter",
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
