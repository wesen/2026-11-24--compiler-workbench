/**
 * Three pass changes found from the hot-shape tables (IRWB-037-G, src/typed/missed.ts). Each is the body of a phase
 * that an existing pass runs (passes.ts), so O2 and `speed` get them without a change to a pipeline list:
 *
 *   threadTests   in `cfg`        a block that only branches on a local is copied into the blocks that jump to it
 *   decideChecks  in `bce`        a check that dominating branches already decide becomes a jump
 *   copyReads     in `constprop`  a read of a copy `x = y` becomes a read of `y` while `y` still holds that value
 *
 * The last two walk the dominator tree with scoped facts about SSA names (`typed.ssa`, a declared need of their
 * passes; `walkDominatorTree` and `ScopedMap` are the framework's). An SSA name has one value per activation of
 * its definition, and a block dominated by a definition, or by a branch edge, is reached only after it, with no
 * newer activation in between: a newer one would have to pass the definition again, and every path from there
 * passes the dominating point again. So "the name `y.2` is what `y` holds here" and "`state.3` is in [0, 8]" are
 * true wherever the walk has them in scope.
 */
import { ScopedMap, walkDominatorTree } from '../framework/dataflow/scoped.js';
import { evalRange, isPure, MAX, MIN, stmtValues, type Loop } from './analyses.js';
import { typeClass, type BlockRec, type StmtRec, type Store, type ValueRec, type WorkFn } from './model.js';
import { VIRTUAL_ENTRY, type SsaFn } from './ssa.js';
import type { Tx } from './tx.js';

type Range = readonly [number, number];
const FULL: Range = [MIN, MAX];

interface Ctx {
  readonly st: Store;
  readonly f: WorkFn;
  readonly tx: Tx;
}

const lastOf = (st: Store, b: BlockRec): StmtRec | undefined =>
  b.stmts.length ? (st.get(b.stmts.at(-1)!) as StmtRec) : undefined;

// ---------- cfg: a block that only tests a local ----------
const copyTree = (tx: Tx, st: Store, id: string, because: string[]): string => {
  const v = st.get(id) as ValueRec;
  return tx.make(v.op, ...v.args.map(a => copyTree(tx, st, a, because)), {
    imm: v.imm,
    from: id,
    because,
    type: v.type ?? 'i32',
  });
};

/**
 * `J: if t goto A else B`, with nothing else in J, is what the join of `a && b` or `a || b` lifts to: each arm
 * assigns `t` and jumps to J. Every block that ends in `goto J` gets J's branch instead. This is tail duplication
 * (as `rotate` does for loop heads), so it is valid whatever the predecessors are; a path that ran a jump and a
 * branch runs one branch. The passes after it finish the job: `t = 0; if t` folds (constprop, cfg), and
 * `t = c; if t` becomes `if c` (subst), on which `typed.ranges` can refine.
 *
 * When the predecessor's own last assignment to `t` is a constant, the branch is decided there and the predecessor
 * jumps straight to the arm (`t = 0; goto J` becomes `t = 0; goto B`), so a nested `&&`, whose inner join only
 * appears once the outer one is gone, needs no constant propagation in between.
 *
 * Loop heads are left alone: copying a head is rotation, which must run after licm (rotate.ts). Returns whether
 * it changed anything.
 */
export function threadTests({ st, f, tx }: Ctx, loops: readonly Loop[]): boolean {
  const heads = new Set(loops.map(L => L.head));
  let changed = false;
  for (const J of f.blocks) {
    if (J.stmts.length !== 1 || J.id === f.blocks[0].id || heads.has(J.id)) continue;
    const test = st.get(J.stmts[0]) as StmtRec;
    if (test.op !== 'br_if' || test.then === test.else || test.then === J.id || test.else === J.id) continue;
    let c = st.get(test.cond!) as ValueRec,
      negated = false;
    if (c.op === 'eqz') {
      c = st.get(c.args[0]) as ValueRec;
      negated = true;
    }
    if (c.op !== 'get' || c.type === 'f32') continue;
    for (const P of f.blocks) {
      if (P.id === J.id) continue;
      const last = lastOf(st, P);
      if (!last || last.op !== 'br' || last.to !== J.id) continue;
      const because = [J.id];
      // the value of t at the end of P, when P's last assignment to it is a constant
      let known: StmtRec | undefined;
      for (let i = P.stmts.length - 2; i >= 0 && !known; i--) {
        const s = st.get(P.stmts[i]) as StmtRec;
        if (s.op === 'set' && s.local === c.imm) known = s;
      }
      const k = known ? (st.get(known.value!) as ValueRec) : undefined;
      if (known && k!.op === 'const' && !k!.type) {
        const taken = (k!.imm !== 0) !== negated;
        tx.replaceStmt(
          last.id,
          { op: 'br', to: taken ? test.then : test.else },
          { because: [J.id, known.id], note: `the test of ${J.id} is decided by ${known.id}` },
        );
        changed = true;
        continue;
      }
      tx.replaceStmt(
        last.id,
        { op: 'br_if', cond: copyTree(tx, st, test.cond!, because), then: test.then, else: test.else },
        { from: test.id, because, note: `the test of ${J.id} copied into ${P.id}` },
      );
      changed = true;
    }
  }
  return changed;
}

// ---------- the walk both SSA phases share ----------
/** The dominator tree of an SSA fact: the children of each block, in the function's block order. */
function domChildren(f: WorkFn, ssa: SsaFn): Map<string, string[]> {
  const kids = new Map<string, string[]>();
  for (const b of f.blocks) {
    const d = ssa.idom[b.id];
    if (d === undefined || d === VIRTUAL_ENTRY) continue;
    if (!kids.has(d)) kids.set(d, []);
    kids.get(d)!.push(b.id);
  }
  return kids;
}

// ---------- constprop: reads of copies ----------
/**
 * For a copy `x = y` (the whole value is a read of `y`), a read of that `x` is replaced by a read of `y` wherever
 * the name of `y` the copy read is still `y`'s current name. Returns the plan: `get` value id -> the local to read
 * instead.
 *
 * A read is replaced wherever it can be. When every read of a copy goes this way and no phi takes it, the copy is
 * dead and dce removes it. `whole` restricts the pass to those copies (all reads or none); measured on the corpus
 * that is worse (various/09-ablation-*.json), so it is off.
 */
export function copyReads({ st, f }: Ctx, ssa: SsaFn, whole = false): Map<string, number> {
  const plan = new Map<string, number>();
  if (ssa.entry !== f.blocks[0].id) return plan;
  // the source of a copy, through earlier copies: x = y, z = x gives z -> y when y's name is the same
  const sourceOf = (name: string): { local: number; name: string } | undefined => {
    const d = ssa.names[name];
    if (!d || d.kind !== 'set') return undefined;
    const v = st.get(d.value!) as ValueRec;
    if (v.op !== 'get') return undefined;
    const from = ssa.uses[v.id];
    if (from === undefined) return undefined;
    if (typeClass(f.locals[d.local].type) !== typeClass(f.locals[v.imm as number].type)) return undefined;
    return { local: v.imm as number, name: from };
  };
  // reads of each name, and the names phis take
  const reads = new Map<string, number>(),
    intoPhi = new Set<string>();
  for (const n of Object.values(ssa.uses)) reads.set(n, (reads.get(n) ?? 0) + 1);
  for (const ps of Object.values(ssa.phis))
    for (const phi of ps) for (const a of Object.values(phi.args)) intoPhi.add(a);
  const through = new Map<string, string[]>();
  const current = new ScopedMap<number, string>();
  for (const [name, d] of Object.entries(ssa.names))
    if (d.block === VIRTUAL_ENTRY) current.set(d.local, name);
  const kids = domChildren(f, ssa);
  const visit = (id: string | undefined) => {
    if (!id) return;
    const v = st.get(id) as ValueRec;
    if (v.op === 'get') {
      const name = ssa.uses[id] ?? '';
      const src = sourceOf(name);
      if (src && current.get(src.local) === src.name) {
        plan.set(id, src.local);
        if (!through.has(name)) through.set(name, []);
        through.get(name)!.push(id);
      }
      return;
    }
    v.args.forEach(visit);
  };
  walkDominatorTree(
    ssa.entry,
    b => kids.get(b) ?? [],
    b => {
      for (const phi of ssa.phis[b] ?? []) current.set(phi.local, phi.name);
      for (const sid of (st.get(b) as BlockRec).stmts) {
        const s = st.get(sid) as StmtRec;
        stmtValues(s).forEach(visit);
        if (s.op === 'set') current.set(s.local!, ssa.defs[sid]);
      }
    },
    [current],
  );
  if (whole)
    for (const [name, gets] of through)
      if (intoPhi.has(name) || gets.length !== reads.get(name)) for (const g of gets) plan.delete(g);
  return plan;
}

// ---------- bce: checks decided by dominating branches ----------
const NEGATE: Record<string, string> = {
  lt: 'ge',
  ge: 'lt',
  le: 'gt',
  gt: 'le',
  eq: 'ne',
  ne: 'eq',
  ltu: 'geu',
  geu: 'ltu',
};
const FLIP: Record<string, string> = { lt: 'gt', gt: 'lt', le: 'ge', ge: 'le', eq: 'eq', ne: 'ne' };

/** Whether `a op b` holds for every pair of values in the two intervals (true), for none (false), or neither. */
export function decideCompare(op: string, a: Range, b: Range): boolean | undefined {
  switch (op) {
    case 'lt':
      return a[1] < b[0] ? true : a[0] >= b[1] ? false : undefined;
    case 'le':
      return a[1] <= b[0] ? true : a[0] > b[1] ? false : undefined;
    case 'gt':
      return a[0] > b[1] ? true : a[1] <= b[0] ? false : undefined;
    case 'ge':
      return a[0] >= b[1] ? true : a[1] < b[0] ? false : undefined;
    case 'eq':
      return a[0] === a[1] && b[0] === b[1] && a[0] === b[0]
        ? true
        : a[1] < b[0] || b[1] < a[0]
          ? false
          : undefined;
    case 'ne': {
      const e = decideCompare('eq', a, b);
      return e === undefined ? undefined : !e;
    }
    // unsigned order is signed order when both sides are known to be non-negative
    case 'ltu':
      return a[0] >= 0 && b[0] >= 0 ? decideCompare('lt', a, b) : undefined;
    case 'geu':
      return a[0] >= 0 && b[0] >= 0 ? decideCompare('ge', a, b) : undefined;
  }
  return undefined;
}

/** The interval of `x` given `x op y` with `y` in `r`, starting from `cur`; undefined when nothing is left. */
export function narrowBy(op: string, cur: Range, r: Range): Range | undefined {
  let [lo, hi] = cur;
  switch (op) {
    case 'lt':
      if (r[1] === MIN) return undefined;
      hi = Math.min(hi, r[1] - 1);
      break;
    case 'le':
      hi = Math.min(hi, r[1]);
      break;
    case 'gt':
      if (r[0] === MAX) return undefined;
      lo = Math.max(lo, r[0] + 1);
      break;
    case 'ge':
      lo = Math.max(lo, r[0]);
      break;
    case 'eq':
      lo = Math.max(lo, r[0]);
      hi = Math.min(hi, r[1]);
      break;
    case 'ne':
      if (r[0] === r[1]) {
        if (lo === r[0]) lo++;
        if (hi === r[0]) hi--;
      }
      break;
    case 'ltu':
      // x <u y with y >= 0: x is not negative (it would be above 2^31 unsigned) and below y
      if (r[0] < 0) return cur;
      lo = Math.max(lo, 0);
      hi = Math.min(hi, r[1] - 1);
      break;
    case 'geu':
      // x >=u y with both non-negative is x >= y
      if (lo < 0 || r[0] < 0) return cur;
      lo = Math.max(lo, r[0]);
      break;
    default:
      return cur;
  }
  return lo > hi ? undefined : [lo, hi];
}

export interface DecidedCheck {
  readonly stmt: string;
  /** The block the branch always goes to. */
  readonly to: string;
  readonly value: boolean;
  /** The branches whose outcome gave the facts used. */
  readonly because: readonly string[];
  readonly note: string;
}

/** How far a name's interval is looked up through the expressions that define it (`row + 1` from `state` is 2). */
const DEPTH = 4;

/**
 * The checks of `f` that dominating branches decide. A fact is an interval for an SSA name, set on entering a
 * block whose only predecessor ends in a `br_if` (so the branch's outcome on that edge holds in the block and in
 * everything it dominates). A name with no fact has the interval of its definition: a parameter's type, 0 for an
 * initial value, and for `x = e` the interval of `e` under the current facts (`evalRange`, which answers the full
 * interval for whatever it does not know, memory included), `DEPTH` definitions deep.
 *
 * With `all`, every `br_if` is a candidate; otherwise only checks, whose taken arm is a trap.
 */
export function decideChecks({ st, f }: Ctx, ssa: SsaFn, all = false): DecidedCheck[] {
  const out: DecidedCheck[] = [];
  if (ssa.entry !== f.blocks[0].id) return out;
  const preds = new Map<string, string[]>();
  for (const b of f.blocks)
    for (const s of b.succ) {
      if (!preds.has(s)) preds.set(s, []);
      preds.get(s)!.push(b.id);
    }
  const facts = new ScopedMap<string, { range: Range; by: readonly string[] }>();
  let used = new Set<string>();
  const ofName = (name: string | undefined, depth: number): Range => {
    if (name === undefined) return FULL;
    const fact = facts.get(name);
    if (fact) fact.by.forEach(b => used.add(b));
    const d = ssa.names[name];
    let base: Range = FULL;
    if (d.kind === 'init') base = [0, 0];
    else if (d.kind === 'param') base = f.locals[d.local].type === 'bool' ? [0, 1] : FULL;
    else if (d.kind === 'set' && depth > 0) base = ofValue(d.value!, depth - 1);
    if (!fact) return base;
    const lo = Math.max(base[0], fact.range[0]),
      hi = Math.min(base[1], fact.range[1]);
    return lo <= hi ? [lo, hi] : fact.range;
  };
  const ofValue = (id: string, depth = DEPTH): Range =>
    evalRange(st, id, new Map(), get => ofName(ssa.uses[get.id], depth));

  /** A condition as a comparison, with `taken` folded in: `!(a < b)` not taken is `a < b`. */
  const asCompare = (cond: string, taken: boolean): { op: string; x: ValueRec; y?: ValueRec } | undefined => {
    let v = st.get(cond) as ValueRec;
    while (v.op === 'eqz') {
      v = st.get(v.args[0]) as ValueRec;
      taken = !taken;
    }
    if (v.type === 'f32') return undefined;
    if (v.op === 'get') return { op: taken ? 'ne' : 'eq', x: v };
    if (!NEGATE[v.op]) return undefined;
    const [x, y] = v.args.map(a => st.get(a) as ValueRec);
    if (x.type === 'f32' || y.type === 'f32') return undefined;
    return { op: taken ? v.op : NEGATE[v.op], x, y };
  };
  const ZERO: Range = [0, 0];
  const narrow = (v: ValueRec, op: string, r: Range, by: string) => {
    if (v.op !== 'get' || v.type === 'f32') return;
    const name = ssa.uses[v.id];
    if (name === undefined) return;
    const cur = ofName(name, DEPTH);
    const next = narrowBy(op, cur, r);
    if (!next || (next[0] === cur[0] && next[1] === cur[1])) return;
    facts.set(name, { range: next, by: [...(facts.get(name)?.by ?? []), by] });
  };
  const assume = (branch: StmtRec, taken: boolean) => {
    const c = asCompare(branch.cond!, taken);
    if (!c) return;
    const rx = ofValue(c.x.id),
      ry = c.y ? ofValue(c.y.id) : ZERO;
    narrow(c.x, c.op, ry, branch.id);
    if (c.y && FLIP[c.op]) narrow(c.y, FLIP[c.op], rx, branch.id);
  };
  const isTrap = (id: string | undefined) => {
    const b = id ? (st.get(id) as BlockRec) : undefined;
    return !!b && b.stmts.length > 0 && (st.get(b.stmts[0]) as StmtRec).op === 'trap';
  };

  const kids = domChildren(f, ssa);
  walkDominatorTree(
    ssa.entry,
    b => kids.get(b) ?? [],
    b => {
      const ps = preds.get(b) ?? [];
      if (ps.length === 1 && ps[0] !== b && b !== ssa.entry) {
        const t = lastOf(st, st.get(ps[0]) as BlockRec);
        if (t && t.op === 'br_if' && t.then !== t.else) assume(t, t.then === b);
      }
      const last = lastOf(st, st.get(b) as BlockRec);
      if (!last || last.op !== 'br_if' || last.then === last.else) return;
      if (!all && !isTrap(last.then) && !isTrap(last.else)) return;
      if (!isPure(st, last.cond!)) return;
      const c = asCompare(last.cond!, true);
      if (!c) return;
      used = new Set();
      const rx = ofValue(c.x.id),
        ry = c.y ? ofValue(c.y.id) : ZERO;
      const value = decideCompare(c.op, rx, ry);
      if (value === undefined) return;
      out.push({
        stmt: last.id,
        to: value ? last.then! : last.else!,
        value,
        because: [...used].sort(),
        note: `always ${value}: ${c.op}([${rx[0]}, ${rx[1]}], [${ry[0]}, ${ry[1]}])`,
      });
    },
    [facts],
  );
  return out;
}
