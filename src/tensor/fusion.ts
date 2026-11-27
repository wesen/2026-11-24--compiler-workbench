// IRWB-029-H: the fused lowering's plan, computed from the Tix IR before any CUDA text is printed.
//
// The plan decides, per statement, which kernel writes it, whether its value lives in global or shared memory, and
// by which rule it got there. It changes no statement's meaning. Substituting a statement recomputes it at a read
// of the same coordinate, and shared memory holds f32 words the way global memory does. The one decision that could
// change a result is the thread mapping, so nothing here splits a fold across threads: every reduction stays one
// thread's serial loop, one rounding per step, in the meaning's order (see `src/tensor/cuda-source.ts`).
import {
  mapExpr,
  plain,
  substitute,
  width,
  type Affine,
  type Expr,
  type Extent,
  type Fn,
  type Statement,
} from './model.js';

export type PlanRule =
  | 'pointwise' // no reduction in the expression: recomputed at every read
  | 'thread-local' // has a reduction: recomputed only at a thread-local read, which keeps the fold's order
  | 'kernel'; // kept as a statement

export interface PlannedStatement {
  statement: Statement;
  rule: PlanRule;
  kernel: number;
  /** `shared` means the value never leaves its kernel */
  storage: 'global' | 'shared';
  /** shared-memory slots: the extent for a per-lane result, or null for one float */
  slots: Affine | null;
}

/** A global row copied into shared memory by the whole block before a thread-0 fold reads it. */
export interface PlanPrefetch {
  tensor: string;
  extent: Affine;
}

export interface PlanKernel {
  /** `row` maps blockIdx to the first axis and threadIdx to the second; `flat` is stage 2's mapping */
  mapping: 'row' | 'flat';
  /** the block axis extent, for a row kernel */
  rows: Affine | null;
  statements: PlannedStatement[];
  prefetch: PlanPrefetch[];
}

export interface FusionPlan {
  /** the function with substituted statements removed and their expressions in their consumers */
  fn: Fn;
  kernels: PlanKernel[];
  decisions: { name: string; rule: PlanRule; kernel: number; storage: 'global' | 'shared' }[];
}

/** One load in a statement, with the tensor it reads and the binders in scope at it. */
export interface LoadSite {
  /** the statement whose expression holds the load */
  statement: Statement;
  tensor: string;
  indices: Affine[];
  inReduce: boolean;
  /** the extents of the reductions enclosing the load, outermost first */
  folds: Extent[];
  scope: Map<string, Extent>;
}

const key = (a: Affine) => JSON.stringify(a);
const extentOf = (a: { extent: Extent }): Extent => a.extent;

export function binders(statement: Statement): Map<string, Extent> {
  return new Map(statement.axes.map(a => [a.id, extentOf(a)] as const));
}

/** Every load in `statement`. */
export function loadSites(statement: Statement): LoadSite[] {
  const out: LoadSite[] = [];
  const walk = (e: Expr, folds: Extent[], scope: Map<string, Extent>) => {
    switch (e.kind) {
      case 'load':
        out.push({
          statement,
          tensor: e.name,
          indices: e.indices,
          inReduce: folds.length > 0,
          folds,
          scope,
        });
        return;
      case 'op':
        e.args.forEach(a => walk(a, folds, scope));
        return;
      case 'reduce': {
        const inner = new Map(scope);
        for (const a of e.axes) inner.set(a.id, extentOf(a));
        const nested = [...folds];
        for (const a of e.axes) nested[nested.length] = extentOf(a);
        walk(e.body, nested, inner);
        return;
      }
    }
  };
  walk(statement.expr, [], binders(statement));
  return out;
}

function hasReduce(e: Expr): boolean {
  if (e.kind === 'reduce') return true;
  if (e.kind === 'op') return e.args.some(hasReduce);
  return false;
}

/**
 * The extent an index covers without leaving its own row, if it does. A plain binder covers the extent of its own
 * `dim`. The stage 1 split-sum address `4 * block + lane` also covers exactly `[0, dim)` because its tail extent is
 * `min(4, dim - 4 * block)`, so a staged row of `dim` floats serves it directly.
 */
function covers(index: Affine, scope: ReadonlyMap<string, Extent>): Affine | undefined {
  const name = plain(index);
  if (name !== undefined) {
    const bound = scope.get(name);
    return bound?.kind === 'dim' ? bound.dim : undefined;
  }
  if (index.constant !== 0 || index.terms.length !== 2) return undefined;
  for (const [o, i] of [
    [0, 1],
    [1, 0],
  ]) {
    const [outer, outerK] = index.terms[o],
      [inner, innerK] = index.terms[i];
    const block = scope.get(outer),
      lane = scope.get(inner);
    if (
      outerK === width &&
      innerK === 1 &&
      block?.kind === 'blocks' &&
      lane?.kind === 'tail' &&
      lane.block === outer &&
      key(block.dim) === key(lane.dim)
    )
      return block.dim;
  }
  return undefined;
}

/**
 * Whether a load of a staged value reads the row's own element at an index the staged copy serves. The planner and
 * the emitter both call this, so a staged copy and its readers cannot disagree.
 */
export function stagedIndex(
  reader: Statement,
  scope: ReadonlyMap<string, Extent>,
  indices: readonly Affine[],
  lane: Affine | null,
): boolean {
  if (plain(indices[0]) !== reader.axes[0].id) return false;
  if (lane === null) return indices.length === 1;
  if (indices.length !== 2) return false;
  const extent = covers(indices[1], scope);
  return extent !== undefined && key(extent) === key(lane);
}

/** The extent of the row an index walks, whether the index is a plain binder or the split-sum address. */
export function laneExtent(index: Affine, scope: ReadonlyMap<string, Extent>): Affine | undefined {
  return covers(index, scope);
}

export function fusePlan(fn: Fn): FusionPlan {
  const statements = fn.statements;
  const result = fn.result;

  // Every read of every statement, by the tensor read. Substitution moves a read but never changes what it reads,
  // so these sites stay right through both rules.
  const readers = new Map<string, LoadSite[]>();
  for (const s of statements)
    for (const site of loadSites(s)) {
      const list = readers.get(site.tensor) ?? [];
      list.push(site);
      readers.set(site.tensor, list);
    }
  const uses = (name: string) => readers.get(name)?.length ?? 0;

  // Compose a substituted producer at each read of it, exactly as the checked `inline` pass does: the producer's
  // axes take the reader's index expressions, so a permuted read composes the right coordinate.
  const compose = (expr: Expr, producer: Statement): Expr =>
    mapExpr(expr, e => {
      if (e.kind !== 'load' || e.name !== producer.name) return e;
      const bindings = new Map(producer.axes.map((a, i) => [a.id, e.indices[i]]));
      return mapExpr(producer.expr, x =>
        x.kind === 'load' ? { ...x, indices: x.indices.map(a => substitute(a, bindings)) } : x,
      );
    });

  // Rule 1: a statement whose expression holds no reduction is recomputed at every read, provided no read sits
  // inside a reduction. A read inside a reduction would put the recomputation in one thread's serial fold: exact,
  // but it would repeat a transcendental a whole row of times in that thread instead of once per lane.
  const substituted = new Map<string, Statement>();
  const rules = new Map<string, PlanRule>();
  const stage1: Statement[] = [];
  const pointwise = new Map<string, Statement>();
  for (const s of statements) {
    let expr = s.expr;
    for (const producer of pointwise.values()) expr = compose(expr, producer);
    const current: Statement = { ...s, expr };
    const parallel = (readers.get(s.name) ?? []).every(site => !site.inReduce);
    if (s.name !== result && uses(s.name) > 0 && parallel && !hasReduce(expr)) {
      pointwise.set(s.name, current);
      rules.set(s.name, 'pointwise');
      continue;
    }
    stage1.push(current);
  }

  // Rule 2: a statement with a reduction is recomputed only where its single read sits at the reader's own
  // coordinate and outside every reduction, so the recomputed fold runs once per element, in the same order.
  const kept: Statement[] = [];
  for (const s of stage1) {
    let expr = s.expr;
    for (const [name, producer] of pointwise) if (name !== s.name) expr = compose(expr, producer);
    const current: Statement = { ...s, expr };
    const reads = (readers.get(s.name) ?? []).filter(site => site.statement.name !== s.name);
    const local =
      s.name !== result &&
      reads.length === 1 &&
      !reads[0].inReduce &&
      reads[0].indices.length === reads[0].statement.axes.length &&
      reads[0].indices.every((a, i) => plain(a) === reads[0].statement.axes[i].id);
    if (hasReduce(expr) && local) {
      substituted.set(s.name, current);
      rules.set(s.name, 'thread-local');
      continue;
    }
    kept.push(current);
    rules.set(s.name, 'kernel');
  }
  return group(fn, kept, rules, substituted);
}

interface RowInfo {
  rows: Affine;
  lanes: Affine | null;
}

function rowInfo(s: Statement): RowInfo | null {
  // The validator already fixes every result axis to a `dim` extent of its own shape, so this decides the mapping,
  // not validity: a block per row needs the outermost axis as the row and at most one axis left for the lanes.
  if (s.axes.length > 2 || s.axes.some(a => a.extent.kind !== 'dim')) return null;
  return { rows: s.axes[0].extent.dim, lanes: s.axes.length === 2 ? s.axes[1].extent.dim : null };
}

function group(
  fn: Fn,
  kept: Statement[],
  rules: Map<string, PlanRule>,
  substituted: Map<string, Statement>,
): FusionPlan {
  // Compose the rule 2 substitutions into their readers, in order, so a reader that holds one carries it.
  const emitted = kept.map(s => {
    let expr = s.expr;
    for (const [name, producer] of substituted)
      if (name !== s.name && rules.get(name) === 'thread-local')
        expr = mapExpr(expr, e => {
          if (e.kind !== 'load' || e.name !== name) return e;
          const bindings = new Map(producer.axes.map((a, i) => [a.id, e.indices[i]]));
          return mapExpr(producer.expr, x =>
            x.kind === 'load' ? { ...x, indices: x.indices.map(a => substitute(a, bindings)) } : x,
          );
        });
    return { ...s, expr };
  });

  const reads = new Map<string, Set<string>>(
    emitted.map(s => [s.name, new Set(loadSites(s).map(site => site.tensor))] as const),
  );
  const kernels: PlanKernel[] = [];
  let run: Statement[] = [];
  let rows: Affine | null = null;
  const flush = () => {
    if (!run.length) return;
    // A run of one statement has nothing fused, so it keeps stage 2's mapping and stage 2's text.
    const mapping = run.length > 1 && run.some(s => s.axes.length === 2) ? 'row' : 'flat';
    // A flat run fuses nothing: stage 2's mapping computes one statement per kernel, so a run of several
    // statements that has no row to fuse on becomes one kernel each.
    for (const statement of mapping === 'row' ? [run] : run.map(s => [s])) {
      const planned: PlannedStatement[] = statement.map(s => ({
        statement: s,
        rule: rules.get(s.name) ?? 'kernel',
        kernel: kernels.length,
        storage: 'global',
        slots: null,
      }));
      kernels.push({ mapping, rows: mapping === 'row' ? rows : null, statements: planned, prefetch: [] });
    }
    run = [];
    rows = null;
  };
  for (const s of emitted) {
    const info = rowInfo(s);
    const inside = new Set(run.map(k => k.name));
    if (
      info &&
      rows &&
      key(info.rows) === key(rows) &&
      [...(reads.get(s.name) ?? [])].some(n => inside.has(n))
    ) {
      run.push(s);
      continue;
    }
    flush();
    run = [s];
    rows = info?.rows ?? null;
  }
  flush();

  // A value read only inside its own kernel is staged in shared memory; everything else is a global buffer. A
  // staging that some reader could not read (a different row element, a permuted address) stays global.
  const sites = new Map(emitted.map(s => [s.name, loadSites(s)] as const));
  for (const kernel of kernels) {
    if (kernel.mapping !== 'row') continue;
    const members = new Set(kernel.statements.map(p => p.statement.name));
    for (const p of kernel.statements) {
      if (p.statement.name === fn.result) continue;
      const lane = p.statement.axes.length === 2 ? p.statement.axes[1].extent.dim : null;
      let staged = true,
        outside = false;
      for (const reader of emitted)
        for (const site of sites.get(reader.name)!)
          if (site.tensor === p.statement.name) {
            if (!members.has(reader.name)) outside = true;
            else if (!stagedIndex(reader, site.scope, site.indices, lane)) staged = false;
          }
      if (!staged || outside) continue;
      p.storage = 'shared';
      p.slots = lane;
    }
    kernel.prefetch = prefetch(kernel);
  }
  return {
    fn: { ...fn, statements: emitted },
    kernels,
    decisions: kernels.flatMap(kernel =>
      kernel.statements.map(p => ({
        name: p.statement.name,
        rule: p.rule,
        kernel: p.kernel,
        storage: p.storage,
      })),
    ),
  };
}

// A thread-0 fold reading a global row would issue strided loads from one thread. Copy the row into shared memory
// with the whole block first, so the loads are coalesced and the fold stays on chip.
function prefetch(kernel: PlanKernel): PlanPrefetch[] {
  const staged = new Set(kernel.statements.filter(p => p.storage === 'shared').map(p => p.statement.name));
  const seen = new Set<string>();
  const out: PlanPrefetch[] = [];
  for (const { statement: s } of kernel.statements) {
    // Only a rank-1 statement runs in one thread; a rank-2 statement reads its row per lane, already coalesced.
    if (s.axes.length !== 1) continue;
    for (const site of loadSites(s)) {
      if (staged.has(site.tensor) || site.indices.length !== 2) continue;
      if (plain(site.indices[0]) !== s.axes[0].id) continue;
      const extent = laneExtent(site.indices[1], site.scope);
      if (extent === undefined) continue;
      const id = site.tensor + '/' + key(extent);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ tensor: site.tensor, extent });
    }
  }
  return out;
}
