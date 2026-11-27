// IRWB-029-F: decide statement fusion from the Tix IR, before emission applies it.
//
// A fused group is an interval of consecutive statements with a shared *row dimension* D: every statement's
// leading axis has extent D, and every load is either row-local (its leading index is exactly the statement's
// row binder and the tensor's leading dimension is D) or row-free (the row binder does not appear in the
// address at all). A row-free read of a tensor produced inside the group reads another row, so it is refused.
// Under these conditions one block can own one row: no element ever needs a value from another row of a group
// tensor. Any other involvement of the row binder in an address (an offset like i+1, a transpose, a
// coefficient other than 1) refuses the statement, and with it the fusion.
import { visit, type Affine, type Expr, type Fn, type Tensor } from './model.js';

export type Segment =
  | { kind: 'single'; index: number }
  | { kind: 'chain'; start: number; end: number; row: Affine }
  | { kind: 'row'; start: number; end: number; row: Affine };

export interface Refusal {
  statement: number;
  reason: string;
}

export interface FusionPlan {
  readonly segments: readonly Segment[];
  readonly refusals: readonly Refusal[];
}

export type LoadExpr = Extract<Expr, { kind: 'load' }>;
export type LoadClass = 'row-local' | 'row-free' | 'other';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const coefficient = (a: Affine, binder: string): number =>
  a.terms.find(([name]) => name === binder)?.[1] ?? 0;
const isPlain = (a: Affine, binder: string): boolean =>
  a.constant === 0 && a.terms.length === 1 && a.terms[0][0] === binder && a.terms[0][1] === 1;

export function classifyLoad(
  e: LoadExpr,
  binder: string,
  tensors: ReadonlyMap<string, Tensor>,
  row: Affine,
): LoadClass {
  if (e.indices.every(f => coefficient(f, binder) === 0)) return 'row-free';
  const tensor = tensors.get(e.name);
  if (
    e.indices.length &&
    isPlain(e.indices[0], binder) &&
    e.indices.slice(1).every(f => coefficient(f, binder) === 0) &&
    tensor &&
    same(tensor.shape[0], row)
  )
    return 'row-local';
  return 'other';
}

// A contraction over a row-free operand (a matrix read like w[d,j] inside a reduction): its per-element dot
// needs the memory-level parallelism of one thread per output element, which the row mapping would serialize
// into one long lane chain (measured 2.5x slower for mlp's second contraction). Such a statement may start a
// group - a pointwise epilogue chains behind it - but never joins one (IRWB-029-F).
function isContraction(
  statement: Fn['statements'][number],
  tensors: ReadonlyMap<string, Tensor>,
  row: Affine,
): boolean {
  const binder = statement.axes[0].id;
  let found = false;
  visit(statement.expr, e => {
    if (found || e.kind !== 'reduce') return;
    let inner = false;
    visit(e.body, x => {
      if (x.kind === 'load' && classifyLoad(x as LoadExpr, binder, tensors, row) === 'row-free') inner = true;
    });
    if (inner) found = true;
  });
  return found;
}

// Why `statement` cannot join a row group with dimension `row` and the producers in `group`, or undefined when
// it can. The candidate's in-group set is exactly the producers already admitted.
function refusal(
  statement: Fn['statements'][number],
  tensors: ReadonlyMap<string, Tensor>,
  row: Affine,
  group: ReadonlySet<string>,
): string | undefined {
  const axis = statement.axes[0]?.extent;
  if (!axis || axis.kind !== 'dim' || !same(axis.dim, row))
    return 'the row extent is not the leading axis, so the row slice is not contiguous';
  const binder = statement.axes[0].id;
  let reason: string | undefined;
  visit(statement.expr, e => {
    if (reason || e.kind !== 'load') return;
    const load = e as LoadExpr;
    const kind = classifyLoad(load, binder, tensors, row);
    if (kind === 'other')
      reason = `the address of ${load.name} involves the row binder beyond a plain leading index`;
    else if (kind === 'row-free' && group.has(load.name))
      reason = `${load.name} is read outside its row within the group`;
  });
  if (!reason && group.size && isContraction(statement, tensors, row))
    reason = 'contains a contraction over a row-free operand, which needs one thread per output element';
  return reason;
}

/** The plan for the stage 2 lowering: one single-statement segment per statement. */
export function singleSegments(fn: Fn): readonly Segment[] {
  return fn.statements.map((_, index) => ({ kind: 'single' as const, index }));
}

/** Group consecutive statements greedily; a statement that cannot join closes the group and is reported. */
export function fusionPlan(fn: Fn): FusionPlan {
  const tensors = new Map<string, Tensor>([...fn.params, ...fn.statements].map(t => [t.name, t]));
  const statements = fn.statements;
  const segments: Segment[] = [];
  const refusals: Refusal[] = [];
  let i = 0;
  while (i < statements.length) {
    const first = statements[i].axes[0]?.extent;
    const row = first?.kind === 'dim' ? first.dim : undefined;
    let end = i;
    if (row !== undefined) {
      while (end < statements.length) {
        const group = new Set(statements.slice(i, end).map(s => s.name));
        const reason = refusal(statements[end], tensors, row, group);
        if (reason) {
          refusals.push({ statement: end, reason });
          break;
        }
        end++;
      }
    }
    if (end > i + 1) {
      const group = statements.slice(i, end);
      segments.push({
        kind: isChain(group) ? 'chain' : 'row',
        start: i,
        end: end - 1,
        row: row!,
      });
      i = end;
    } else {
      segments.push({ kind: 'single', index: i });
      i++;
    }
  }
  return { segments, refusals };
}

// The register-forwarding mapping: every statement has the same shape after the row axis, and every in-group
// read is elementwise at the reader's own coordinates, so one thread per output element can compute the whole
// chain, passing producer values through registers. Reductions are allowed: each element runs its own loops,
// exactly as in the stage 2 kernel. This covers elementwise chains of any rank and pointwise epilogues over
// contractions (mlp's bias and GELU behind its dense layer).
function isChain(group: readonly Fn['statements'][number][]): boolean {
  const names = new Set(group.map(s => s.name));
  const shape = JSON.stringify(group[0].axes.slice(1).map(a => a.extent.dim));
  if (group.some(s => JSON.stringify(s.axes.slice(1).map(a => a.extent.dim)) !== shape)) return false;
  for (const s of group) {
    let ok = true;
    visit(s.expr, e => {
      if (!ok || e.kind !== 'load' || !names.has(e.name)) return;
      const load = e as LoadExpr;
      ok =
        load.indices.length === s.axes.length && s.axes.every((axis, k) => isPlain(load.indices[k], axis.id));
    });
    if (!ok) return false;
  }
  return true;
}
