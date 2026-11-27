import { plain, visit, type Affine, type Expr, type Fn, type Statement } from './model.js';

/**
 * IRWB-029-I: fusion plans for the CUDA lowering.
 *
 * A plan turns a run of Tix statements into one CUDA kernel without changing any element's evaluation
 * order. Legality is decided here, from the IR, before anything is emitted; a run that cannot be shown
 * order-preserving stays at stage 2's one-kernel-per-statement lowering. Because stage 2 stores and
 * reloads exact f32 words, and a fused kernel computes every needed element with the producer's own
 * tree and fold order, every plan accepted here is bit-identical to the unfused lowering.
 *
 * Two forms cover the corpus:
 *  - `flat`: all members share the driver's shape and every load of a member is identity-indexed, so
 *    each thread computes the chain once, in definition order, into locals (elementwise chains and
 *    epilogues over a contraction, e.g. mlp's h into g).
 *  - `row`: one block per row of the driver's non-row axes; row-element members are staged through
 *    shared memory and row-scalar members (shape = driver minus the row axis) are computed once per row
 *    by one thread, folding reductions sequentially in the meaning's order (softmax, layernorm,
 *    attention's score/shift/e/z/weight run).
 */

export type MemberRole = 'element' | 'scalar';

export interface KernelPlan {
  readonly form: 'single' | 'flat' | 'row';
  readonly members: readonly Statement[];
  readonly driver: Statement;
  readonly roles: ReadonlyMap<string, MemberRole>;
  /** Row form: element members staged through shared memory, in member order. */
  readonly staged: readonly string[];
  /** Row form: row-scalar members with a shared slot, in member order. */
  readonly slots: readonly string[];
  /** Members whose values reach global memory (an outside consumer or the function result). */
  readonly writes: readonly string[];
}

const key = (a: Affine) => JSON.stringify(a);

function sameShape(a: Affine[], b: Affine[]): boolean {
  return a.length === b.length && a.every((x, i) => key(x) === key(b[i]));
}

function loadsOf(e: Expr, members: ReadonlySet<string>): Map<string, Affine[][]> {
  const out = new Map<string, Affine[][]>();
  visit(e, x => {
    if (x.kind === 'load' && members.has(x.name)) out.set(x.name, [...(out.get(x.name) ?? []), x.indices]);
  });
  return out;
}

/**
 * Load rules inside a row group with driver rank `rank` (row axis last). A load of a row-element member
 * must keep every non-row component on the current row — exactly the consumer's own binder for that
 * axis — while its row component may be any in-scope affine form, because the staged row is indexed by
 * it. A load of a row-scalar member must name exactly the consumer's own row coordinates. Loads of
 * statements outside the group are unconstrained: they read materialized global buffers. Binder ids are
 * parser-fresh, so a plain component naming the consumer's own binder cannot be confused with a
 * reduction binder, and the IR validator has already checked every address against its scope.
 */
function rowLoadsLegal(s: Statement, roles: ReadonlyMap<string, MemberRole>, rank: number): boolean {
  const own = s.axes.map(a => a.id);
  return [...loadsOf(s.expr, new Set(roles.keys()))].every(([name, tuples]) =>
    tuples.every(tuple => {
      const fixed = roles.get(name) === 'element' ? rank - 1 : tuple.length;
      return tuple.every((a, k) => k >= fixed || plain(a) === own[k]);
    }),
  );
}

/** Flat form: every load of a member must be identity-indexed, so one local per member per thread. */
function flatLoadsLegal(s: Statement, members: ReadonlySet<string>): boolean {
  const own = s.axes.map(a => a.id);
  return [...loadsOf(s.expr, members)].every(([, tuples]) =>
    tuples.every(tuple => tuple.every((a, k) => plain(a) === own[k])),
  );
}

function classify(s: Statement, d: Statement): MemberRole | undefined {
  if (sameShape(s.shape, d.shape)) return 'element';
  if (
    d.shape.length >= 2 &&
    s.shape.length === d.shape.length - 1 &&
    sameShape(s.shape, d.shape.slice(0, -1))
  )
    return 'scalar';
  return undefined;
}

function plan(
  form: KernelPlan['form'],
  fn: Fn,
  members: readonly Statement[],
  driver: Statement,
  roles: ReadonlyMap<string, MemberRole>,
): KernelPlan {
  const names = new Set(members.map(m => m.name));
  const readLater = new Set<string>(),
    readOutside = new Set<string>();
  for (const s of fn.statements) {
    const inside = names.has(s.name);
    visit(s.expr, e => {
      if (e.kind !== 'load' || !names.has(e.name)) return;
      (inside ? readLater : readOutside).add(e.name);
    });
  }
  return {
    form,
    members,
    driver,
    roles,
    staged: members.filter(m => roles.get(m.name) === 'element' && readLater.has(m.name)).map(m => m.name),
    slots: members.filter(m => roles.get(m.name) === 'scalar' && readLater.has(m.name)).map(m => m.name),
    writes: members.filter(m => m.name === fn.result || readOutside.has(m.name)).map(m => m.name),
  };
}

function tryRow(fn: Fn, start: number): KernelPlan | undefined {
  const sts = fn.statements;
  for (let p = start; p < sts.length; p++) {
    const d = sts[p];
    if (d.shape.length < 2) continue;
    const roles = new Map<string, MemberRole>();
    let end = start;
    for (; end < p; end++) {
      if (classify(sts[end], d) !== 'scalar') break;
      roles.set(sts[end].name, 'scalar');
      if (!rowLoadsLegal(sts[end], roles, d.shape.length)) {
        roles.delete(sts[end].name);
        break;
      }
    }
    if (end < p) continue;
    roles.set(d.name, 'element');
    if (!rowLoadsLegal(d, roles, d.shape.length)) continue;
    end = p + 1;
    while (end < sts.length) {
      const role = classify(sts[end], d);
      if (!role) break;
      roles.set(sts[end].name, role);
      if (!rowLoadsLegal(sts[end], roles, d.shape.length)) {
        roles.delete(sts[end].name);
        break;
      }
      end++;
    }
    if (end - start < 2 || ![...roles.values()].includes('scalar')) continue;
    return plan('row', fn, sts.slice(start, end), d, roles);
  }
  return undefined;
}

function tryFlat(fn: Fn, start: number): KernelPlan | undefined {
  const sts = fn.statements;
  const d = sts[start];
  const roles = new Map<string, MemberRole>([[d.name, 'element']]);
  const names = new Set<string>([d.name]);
  let end = start + 1;
  while (end < sts.length && classify(sts[end], d) === 'element' && flatLoadsLegal(sts[end], names)) {
    roles.set(sts[end].name, 'element');
    names.add(sts[end].name);
    end++;
  }
  return end - start >= 2 ? plan('flat', fn, sts.slice(start, end), sts[end - 1], roles) : undefined;
}

export function planKernels(fn: Fn, fuse: boolean): KernelPlan[] {
  const single = (s: Statement): KernelPlan => ({
    form: 'single',
    members: [s],
    driver: s,
    roles: new Map([[s.name, 'element' as const]]),
    staged: [],
    slots: [],
    writes: [s.name],
  });
  if (!fuse) return fn.statements.map(single);
  const plans: KernelPlan[] = [];
  for (let i = 0; i < fn.statements.length; ) {
    const fused = tryRow(fn, i) ?? tryFlat(fn, i);
    if (fused) {
      plans.push(fused);
      i += fused.members.length;
    } else {
      plans.push(single(fn.statements[i]));
      i++;
    }
  }
  return plans;
}
