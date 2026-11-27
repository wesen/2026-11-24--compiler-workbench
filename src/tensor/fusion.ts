// IRWB-029-G: which statements become one kernel, and on which threads.
//
// Stage 2 emits one kernel per statement. This module decides, from the Tix IR alone and before any CUDA is written,
// whether a consecutive run of statements may be lowered into one kernel without changing any result bit. Two
// policies are implemented, both of them order-preserving by construction:
//
//  - flat: a producer is inlined at a load site whose address tuple maps its free axes bijectively onto the
//    consumer's free axes. The tree, its rounding sites and its reduction order are unchanged, and it is evaluated
//    exactly once per output element, so the store/load pair that disappears carried no rounding.
//  - row: a block per row. Members of a group share the leading row axes and have at most one further free axis. A
//    member with no further axis is a per-row scalar, computed by one thread with the meaning's sequential folds; a
//    member with one is computed by the block's threads over that axis. Intermediates and the rows they read are
//    staged in shared memory, which copies f32 words and nothing else.
//
// Everything a decision depends on is a predicate over the IR, so an unfusable group simply reverts to stage 2's one
// kernel per statement. Fusion is never needed for the lowering to be correct.
import { constant, plain, visit, type Affine, type Axis, type Statement, type Tensor, type Fn } from './model.js';

/** A producer inlined into the anchor's element body (flat policy). */
export interface FlatKernel {
  readonly kind: 'flat';
  readonly anchor: Statement;
  readonly inline: readonly Statement[];
}
export type Dest = { readonly kind: 'shared'; readonly slot: number } | { readonly kind: 'global' };
export interface Slot {
  readonly kind: 'row' | 'scalar';
  /** Elements in the slot: the extent of the staged tensor's free axis, or one for a per-row scalar. */
  readonly dim: Affine;
}
export type RowPhase =
  | { readonly kind: 'stage'; readonly tensor: string; readonly slot: number }
  | { readonly kind: 'scalar'; readonly statement: Statement; readonly dest: Dest }
  | { readonly kind: 'vector'; readonly statement: Statement; readonly dest: Dest };
export interface RowKernel {
  readonly kind: 'row';
  /** The block axes: every member's leading free axes, positionally. */
  readonly rows: readonly Axis[];
  readonly threads: number;
  readonly slots: readonly Slot[];
  /** Tensors read from shared memory instead of global memory, and their slot. */
  readonly staged: ReadonlyMap<string, number>;
  /** In order; each phase is separated from the next by a barrier when it writes shared memory. */
  readonly phases: readonly RowPhase[];
}
export type Kernel = FlatKernel | RowKernel;

const same = (a: Affine, b: Affine) => JSON.stringify(a) === JSON.stringify(b);
const single = (statement: Statement): FlatKernel => ({ kind: 'flat', anchor: statement, inline: [] });

/** Elements per block of a row kernel; measured in scripts/02-shared-row-probe.mjs (see the design). */
const rowThreads = 128;

/**
 * The group of statements starting at `i` that may share one kernel. A member that is read outside the group, or
 * that is the function's result, has to be its last statement, so groups are cut there.
 */
function truncate(statements: readonly Statement[], i: number, end: number, lastUse: Map<string, number>, result: string) {
  for (let e = end; ; ) {
    let cut = -1;
    for (let j = i; j < e - 1 && cut < 0; j++)
      if ((lastUse.get(statements[j].name) ?? -1) >= e || statements[j].name === result) cut = j;
    if (cut < 0) return e;
    e = cut + 1;
  }
}

/** Loads of `name` in `statement` as (statement, address tuple) pairs. */
function loads(statement: Statement): { name: string; indices: Affine[] }[] {
  const out: { name: string; indices: Affine[] }[] = [];
  visit(statement.expr, e => {
    if (e.kind === 'load') out.push({ name: e.name, indices: e.indices });
  });
  return out;
}

// ---------------------------------------------------------------- flat policy

/**
 * Extent of the flat group at `i`: how far the bijective-free-coordinate inlining rule holds. Every load of a member
 * must address it through plain binder names of the consumer that are all free axes of the consumer, exactly once,
 * which makes the map a bijection: the member is evaluated once per output element, from the same tree.
 */
function flatEnd(statements: readonly Statement[], i: number): number {
  const sites = new Map<string, number>();
  let end = i + 1;
  for (; end < statements.length; end++) {
    const consumer = statements[end];
    const members = statements.slice(i, end);
    const fresh = new Map<string, number>();
    let ok = true;
    for (const { name, indices } of loads(consumer)) {
      const producer = members.find(m => m.name === name);
      if (!producer) continue;
      if (producer.axes.length !== consumer.axes.length) {
        ok = false;
        break;
      }
      const seen = new Set<string>();
      for (const a of indices) {
        const binder = plain(a);
        if (binder === undefined || seen.has(binder) || !consumer.axes.some(axis => axis.id === binder)) {
          ok = false;
          break;
        }
        seen.add(binder);
      }
      if (!ok) break;
      fresh.set(name, (fresh.get(name) ?? 0) + 1);
    }
    // one use per member: inlining a producer at two sites would duplicate whatever work its tree does
    for (const [name, count] of fresh) if ((sites.get(name) ?? 0) + count > 1) ok = false;
    if (!ok) break;
    for (const [name, count] of fresh) sites.set(name, (sites.get(name) ?? 0) + count);
  }
  return end;
}

// ----------------------------------------------------------------- row policy

/** Extent of a row group at `i` with `m` block axes, or null when the statements cannot share that many rows. */
function rowEnd(statements: readonly Statement[], i: number, m: number, tensors: ReadonlyMap<string, Tensor>) {
  const first = statements[i];
  if (first.axes.length < m) return null;
  const rowDims = first.axes.slice(0, m).map(axis => axis.extent.dim);
  let end = i + 1;
  for (; end < statements.length; end++) {
    const s = statements[end],
      rank = s.axes.length;
    if (rank < m || rank > m + 1) break;
    if (!s.axes.slice(0, m).every((axis, k) => same(axis.extent.dim, rowDims[k]))) break;
    const members = new Set(statements.slice(i, end).map(x => x.name));
    let ok = true;
    for (const { name, indices } of loads(s)) {
      if (!members.has(name)) continue;
      // a staged member is a row of the block; its reader must address the row's own coordinates
      const member = tensors.get(name)!;
      if (member.shape.length < m || member.shape.length > m + 1) {
        ok = false;
        break;
      }
      for (let k = 0; k < m && ok; k++) if (plain(indices[k]) !== s.axes[k].id) ok = false;
      if (!ok) break;
    }
    if (!ok) break;
  }
  return end;
}

/** True when every load of `name` in the group addresses it as (row coordinates…, at most one free affine). */
function stageable(
  statementSites: readonly { statement: Statement; indices: Affine[] }[],
  rank: number,
  m: number,
): boolean {
  if (rank < m || rank > m + 1) return false;
  return statementSites.every(
    ({ statement, indices }) =>
      statement.axes.length >= m &&
      statement.axes.slice(0, m).every((axis, k) => plain(indices[k]) === axis.id),
  );
}

function buildRow(
  statements: readonly Statement[],
  i: number,
  end: number,
  m: number,
  tensors: ReadonlyMap<string, Tensor>,
): RowKernel {
  const sites = new Map<string, { statement: Statement; indices: Affine[] }[]>();
  for (let j = i; j < end; j++)
    for (const site of loads(statements[j])) {
      const list = sites.get(site.name) ?? [];
      list.push({ statement: statements[j], indices: site.indices });
      sites.set(site.name, list);
    }
  const staged = new Map<string, number>(),
    slots: Slot[] = [],
    phases: RowPhase[] = [];
  const stage = (name: string) => {
    if (staged.has(name)) return;
    const tensor = tensors.get(name)!;
    if (!stageable(sites.get(name)!, tensor.shape.length, m)) return;
    const slot = slots.length;
    slots.push(
      tensor.shape.length === m
        ? { kind: 'scalar', dim: constant(1) }
        : { kind: 'row', dim: tensor.shape[m] },
    );
    staged.set(name, slot);
    phases.push({ kind: 'stage', tensor: name, slot });
  };
  for (let j = i; j < end; j++) {
    const s = statements[j];
    for (const { name } of loads(s)) stage(name);
    if (j === end - 1) {
      phases.push({
        kind: s.axes.length === m ? 'scalar' : 'vector',
        statement: s,
        dest: { kind: 'global' },
      } as RowPhase);
    } else {
      const slot = slots.length;
      slots.push(
        s.axes.length === m ? { kind: 'scalar', dim: constant(1) } : { kind: 'row', dim: s.shape[m] },
      );
      staged.set(s.name, slot);
      phases.push({
        kind: s.axes.length === m ? 'scalar' : 'vector',
        statement: s,
        dest: { kind: 'shared', slot },
      } as RowPhase);
    }
  }
  return { kind: 'row', rows: statements[i].axes.slice(0, m), threads: rowThreads, slots, staged, phases };
}

/**
 * The kernels of `fn` under the fused lowering. Statements are walked in order; at each position the policy that
 * covers more statements wins, and a tie goes to the flat policy, which needs no barrier and keeps one thread per
 * output element.
 */
export function planFusion(fn: Fn): Kernel[] {
  const statements = fn.statements;
  const tensors = new Map<string, Tensor>([...fn.params, ...statements].map(t => [t.name, t]));
  const lastUse = new Map<string, number>();
  statements.forEach((s, index) => {
    for (const { name } of loads(s)) lastUse.set(name, index);
  });
  const kernels: Kernel[] = [];
  for (let i = 0; i < statements.length; ) {
    let best = { end: truncate(statements, i, flatEnd(statements, i), lastUse, fn.result), rows: 0 };
    for (let m = 1; m <= statements[i].axes.length; m++) {
      const grown = rowEnd(statements, i, m, tensors);
      if (grown === null) continue;
      const end = truncate(statements, i, grown, lastUse, fn.result);
      if (end - i > best.end - i) best = { end, rows: m };
    }
    const end = best.end;
    if (end - i === 1) kernels.push(single(statements[i]));
    else if (best.rows) kernels.push(buildRow(statements, i, end, best.rows, tensors));
    else
      kernels.push({
        kind: 'flat',
        anchor: statements[end - 1],
        inline: statements.slice(i, end - 1),
      });
    i = end;
  }
  return kernels;
}
