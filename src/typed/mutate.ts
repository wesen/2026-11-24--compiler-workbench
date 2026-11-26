/**
 * IRWB-005 D2a: mutation operators over `typed.blocks`, and the pass that applies one of them.
 *
 * A mutant is a deliberately wrong revision: the base revision with one small change at one site, made by an
 * operator that models a bug a real pass of this compiler could have (a wrong constant from fold, a flipped
 * comparison from simplify, a dropped bounds check from bce, a wrong shift from strength, a wrong merged range from
 * bcm, a trapping expression hoisted by licm, a wrong float rule or constant, a store dce thought dead). Mutants are
 * applied by `mutantPass`, an ordinary typed pass whose parameter is the site, so `Program.apply` judges a mutant
 * exactly as it judges a pass: validation, declared writes, the meaning contract against r0.
 *
 * Sites are enumerated in a fixed order (function order, block order, statement order, each statement's value
 * fields in the evaluator's order, value trees in pre-order), so every number derived from a site list is
 * reproducible. No operator duplicates another, and none produces a change that is equivalent by construction
 * (swapping two equal operands).
 *
 * The module also holds what classifying a surviving mutant needs: the functions whose cases can observe a mutation
 * (`affected`), a finite input domain for exhaustive comparison (`finiteDomain`), and a comparison of two revisions
 * on a list of cases (`compareOn`).
 */
import { hasEffect, isPure, readsOf, type LiveView } from './analyses.js';
import { agrees, evaluate, Memory, type Case, type FunctionInputs, type RunResult } from './evaluate.js';
import { F32_RESULT } from './f32.js';
import { show, showStmt } from './listing.js';
import type { BlockRec, StmtRec, Store, TypedBlocks, ValueOp, ValueRec, WorkFn } from './model.js';
import { typedPass, type TypedPass } from './passes.js';
import { TxError, type Tx } from './tx.js';

export type MutationOperator =
  | 'const'
  | 'cmp-flip'
  | 'cmp-weaken'
  | 'swap'
  | 'shift'
  | 'drop-check'
  | 'check-range'
  | 'hoist-trap'
  | 'f32'
  | 'drop-store';

export const MUTATION_OPERATORS: readonly MutationOperator[] = [
  'const',
  'cmp-flip',
  'cmp-weaken',
  'swap',
  'shift',
  'drop-check',
  'check-range',
  'hoist-trap',
  'f32',
  'drop-store',
];

/** What each operator models: the pass whose bug it imitates (for reports). */
export const OPERATOR_MODELS: Readonly<Record<MutationOperator, string>> = {
  const: 'fold/constprop: a constant off by one',
  'cmp-flip': 'simplify: a comparison negated',
  'cmp-weaken': 'an off-by-one bound, or signed/unsigned confused',
  swap: 'a rule with its operands exchanged',
  shift: 'strength/simplify: a wrong shift amount or shift kind',
  'drop-check': 'bce: a bounds check removed without proof',
  'check-range': 'bcm: a check that admits one position too many',
  'hoist-trap': 'licm: a trapping expression moved above its guard',
  f32: 'a float rule or folded float constant wrong',
  'drop-store': 'dce: a store treated as dead',
};

export interface MutationSite {
  readonly operator: MutationOperator;
  /** The function mutated. */
  readonly fn: string;
  /** The value (or, for statement operators, the statement) id in the base revision. */
  readonly target: string;
  /** Which change: '+1', '-1', the new operator, 'unchecked', 'ulp', 'sign', 'hoist', 'drop', ... */
  readonly variant: string;
  /** The statement holding the target. */
  readonly stmt: string;
  /** The site as listed in the base, for reports. */
  readonly text: string;
}

const CMP_NEGATE: Readonly<Record<string, ValueOp>> = {
  eq: 'ne',
  ne: 'eq',
  lt: 'ge',
  ge: 'lt',
  gt: 'le',
  le: 'gt',
  ltu: 'geu',
  geu: 'ltu',
};
const CMP_WEAKEN: Readonly<Record<string, readonly ValueOp[]>> = {
  lt: ['le', 'ltu'],
  le: ['lt'],
  gt: ['ge'],
  ge: ['gt', 'geu'],
  ltu: ['lt'],
  geu: ['ge'],
};
const NONCOMMUTATIVE = new Set<string>([
  'sub',
  'div',
  'rem',
  'shl',
  'shr',
  'shru',
  'lt',
  'gt',
  'le',
  'ge',
  'ltu',
  'geu',
  'fsub',
  'fdiv',
  'fcopysign',
  'flt',
  'fgt',
  'fle',
  'fge',
]);
const SHIFTS = new Set<string>(['shl', 'shr', 'shru']);
const F32_SWAP: Readonly<Record<string, readonly ValueOp[]>> = {
  fadd: ['fsub'],
  fsub: ['fadd'],
  fmul: ['fdiv'],
  fdiv: ['fmul'],
  fmin: ['fmax'],
  fmax: ['fmin'],
  flt: ['fle'],
  fle: ['flt'],
  fgt: ['fge'],
  fge: ['fgt'],
  feq: ['fne'],
  fne: ['feq'],
  ffloor: ['fceil'],
  fceil: ['ffloor'],
  ftrunc: ['ffloor'],
  f2i: ['f2u'],
  f2u: ['f2i'],
  i2f: ['u2f'],
  u2f: ['i2f'],
};
/** Operators whose evaluation may trap (a call is excluded from hoisting: it has effects beyond a trap). */
const TRAPPING = new Set<string>(['div', 'rem', 'load', 'load16u', 'caddr']);

const sameTree = (st: Store, a: string, b: string): boolean => {
  const x = st.get(a) as ValueRec,
    y = st.get(b) as ValueRec;
  return (
    x.op === y.op &&
    x.imm === y.imm &&
    x.type === y.type &&
    x.args.length === y.args.length &&
    x.args.every((u, i) => sameTree(st, u, y.args[i]))
  );
};
const treeHas = (st: Store, id: string, ops: ReadonlySet<string>): boolean => {
  const v = st.get(id) as ValueRec;
  return ops.has(v.op) || v.args.some(a => treeHas(st, a, ops));
};
const readsMemory = (st: Store, id: string) => treeHas(st, id, new Set(['load', 'load16u', 'caddr', 'call']));
const lastStmt = (st: Store, b: BlockRec): StmtRec | undefined =>
  b.stmts.length ? (st.get(b.stmts.at(-1)!) as StmtRec) : undefined;
const startsWithTrap = (st: Store, block: string | undefined): boolean => {
  const b = block ? (st.get(block) as BlockRec | undefined) : undefined;
  return !!b && !!b.stmts.length && (st.get(b.stmts[0]) as StmtRec).op === 'trap';
};
/** A branch-form bounds check: a `br_if` one of whose arms is a block that traps at once. */
const checkArm = (st: Store, s: StmtRec): 'then' | 'else' | null =>
  s.op !== 'br_if' || s.then === s.else
    ? null
    : startsWithTrap(st, s.then)
      ? 'then'
      : startsWithTrap(st, s.else)
        ? 'else'
        : null;

export interface SiteOptions {
  /** Only these functions (default: all). */
  readonly fns?: readonly string[];
  /** Only these operators (default: all). */
  readonly operators?: readonly MutationOperator[];
  /** Liveness per function; `hoist-trap` needs it to keep the moved assignment invisible on the other path. */
  readonly live?: (fn: string) => LiveView;
}

/** Every mutation site of a revision, in a fixed order. */
export function mutationSites(st: Store, options: SiteOptions = {}): MutationSite[] {
  const want = new Set(options.operators ?? MUTATION_OPERATORS);
  const out: MutationSite[] = [];
  for (const f of st.fns.values()) {
    if (options.fns && !options.fns.includes(f.name)) continue;
    const preds = new Map<string, string[]>(f.blocks.map(b => [b.id, []]));
    for (const b of f.blocks) for (const s of b.succ) preds.get(s)?.push(b.id);
    for (const b of f.blocks)
      b.stmts.forEach((sid, index) => {
        const s = st.get(sid) as StmtRec;
        const site = (operator: MutationOperator, target: string, variant: string, text: string) => {
          if (want.has(operator)) out.push({ operator, fn: f.name, target, variant, stmt: sid, text });
        };
        // value operators, in the evaluator's order of the statement's fields
        const fields = s.op === 'store' ? (['addr', 'value'] as const) : (['value', 'cond'] as const);
        const visit = (id: string, parent?: ValueRec, slot?: number): void => {
          const v = st.get(id) as ValueRec;
          valueSites(st, v, parent, slot, site);
          v.args.forEach((a, i) => visit(a, v, i));
        };
        for (const k of fields) if (s[k]) visit(s[k]!);
        // statement operators
        const arm = checkArm(st, s);
        if (arm) {
          site('drop-check', sid, 'branch', showStmt(st, sid));
          const c = st.get(s.cond!) as ValueRec;
          if ((c.op === 'geu' && arm === 'then') || (c.op === 'ltu' && arm === 'else'))
            site('check-range', c.args[1], 'len+1', showStmt(st, sid));
        }
        if (s.op === 'store') site('drop-store', sid, 'drop', showStmt(st, sid));
        if (want.has('hoist-trap') && options.live && hoistable(st, f, b, index, preds, options.live(f.name)))
          site('hoist-trap', sid, 'hoist', showStmt(st, sid));
      });
  }
  return out;
}

function valueSites(
  st: Store,
  v: ValueRec,
  parent: ValueRec | undefined,
  slot: number | undefined,
  site: (operator: MutationOperator, target: string, variant: string, text: string) => void,
): void {
  const text = show(st, v.id);
  if (v.op === 'const') {
    const shiftAmount = parent && SHIFTS.has(parent.op) && slot === 1;
    if (v.type === 'f32') {
      site('f32', v.id, 'ulp', text);
      site('f32', v.id, 'sign', text);
    } else if (!shiftAmount) {
      site('const', v.id, '+1', text);
      site('const', v.id, '-1', text);
    }
    return;
  }
  if (!v.type && CMP_NEGATE[v.op]) site('cmp-flip', v.id, CMP_NEGATE[v.op], text);
  for (const w of (!v.type && CMP_WEAKEN[v.op]) || []) site('cmp-weaken', v.id, w, text);
  if (NONCOMMUTATIVE.has(v.op) && v.args.length === 2 && !sameTree(st, v.args[0], v.args[1]))
    site('swap', v.id, 'swap', text);
  if (SHIFTS.has(v.op)) {
    const amount = st.get(v.args[1]) as ValueRec;
    if (amount.op === 'const') {
      const k = amount.imm as number;
      if (k + 1 <= 31) site('shift', v.id, `k+1`, text);
      if (k - 1 >= 0) site('shift', v.id, `k-1`, text);
    }
    if (v.op === 'shr') site('shift', v.id, 'shru', text);
    if (v.op === 'shru') site('shift', v.id, 'shr', text);
  }
  if (v.op === 'caddr') {
    site('drop-check', v.id, 'unchecked', text);
    if (isPure(st, v.args[1])) site('check-range', v.id, 'p<=cap', text);
  }
  for (const w of F32_SWAP[v.op] ?? []) site('f32', v.id, w, text);
}

/**
 * Whether statement `index` of block `b` may move to the end of b's only predecessor P (before P's conditional
 * branch) so that the only possible change is a trap on P's other path: s is a set or eval whose value can trap and
 * makes no call; nothing before it in b writes what it reads, reads or writes what it writes, or (when it reads
 * memory) writes memory; P's condition does not read what it writes; and that local is dead at P's other successor.
 */
function hoistable(
  st: Store,
  f: WorkFn,
  b: BlockRec,
  index: number,
  preds: ReadonlyMap<string, readonly string[]>,
  live: LiveView,
): boolean {
  const s = st.get(b.stmts[index]) as StmtRec;
  if ((s.op !== 'set' && s.op !== 'eval') || !s.value) return false;
  if (!treeHas(st, s.value, TRAPPING) || treeHas(st, s.value, new Set(['call', 'result']))) return false;
  if (b.id === f.blocks[0].id) return false;
  const ps = preds.get(b.id) ?? [];
  if (ps.length !== 1 || ps[0] === b.id) return false;
  const P = st.get(ps[0]) as BlockRec,
    term = lastStmt(st, P);
  if (!term || term.op !== 'br_if' || term.then === term.else) return false;
  const other = term.then === b.id ? term.else! : term.then!;
  if (other === b.id) return false;
  const reads = readsOf(st, s.value),
    memory = readsMemory(st, s.value);
  for (let i = 0; i < index; i++) {
    const t = st.get(b.stmts[i]) as StmtRec;
    if (t.op === 'set' && (reads.has(t.local!) || (s.op === 'set' && t.local === s.local))) return false;
    if (s.op === 'set')
      for (const x of [t.value, t.cond, t.addr]) if (x && readsOf(st, x).has(s.local!)) return false;
    if (
      memory &&
      (t.op === 'store' ||
        t.op === 'zero' ||
        [t.value, t.addr].some(x => x && hasEffect(st, x) && treeHas(st, x, new Set(['call']))))
    )
      return false;
  }
  if (s.op === 'set') {
    if (readsOf(st, term.cond).has(s.local!)) return false;
    if (live.liveIn(other).has(s.local!)) return false;
  }
  return true;
}

const because = (site: MutationSite) => ({
  because: [`mutant:${site.operator}:${site.variant}`],
  note: `mutant ${site.operator} ${site.variant}`,
});

/** A copy of a value tree (the copy has its own ids; a value has one user). */
function copyTree(tx: Tx, st: Store, id: string): string {
  const v = st.get(id) as ValueRec;
  if (v.op === 'const') return tx.const(v.imm as number, { from: id, ...(v.type ? { type: v.type } : {}) });
  return tx.make(v.op, ...v.args.map(a => copyTree(tx, st, a)), {
    from: id,
    ...(v.imm !== undefined ? { imm: v.imm } : {}),
    type: v.type ?? (F32_RESULT.has(v.op) ? 'f32' : 'i32'),
  });
}

/** Apply one mutation to function `f` through its transaction. Throws if the site is not there. */
export function applyMutation(st: Store, f: WorkFn, tx: Tx, site: MutationSite): void {
  const opts = because(site);
  const stmtOps = new Set<MutationOperator>(['drop-store', 'hoist-trap']);
  const branch = site.operator === 'drop-check' && site.variant === 'branch';
  if (stmtOps.has(site.operator) || branch) {
    const s = st.get(site.target) as StmtRec | undefined;
    if (!s || s.kind !== 'stmt') throw new TxError('absent', `mutant: no statement ${site.target}`);
    if (site.operator === 'drop-store') return tx.remove(s.id, opts);
    if (branch) {
      const arm = checkArm(st, s);
      if (!arm) throw new TxError('absent', `mutant: ${s.id} is not a bounds check`);
      tx.replaceStmt(s.id, { op: 'br', to: arm === 'then' ? s.else : s.then }, opts);
      return;
    }
    // hoist-trap: to the end of the only predecessor, before its branch
    const b = tx.blockOf(s.id)!;
    const pred = f.blocks.find(x => x.succ.includes(b.id))!;
    tx.move(s.id, tx.at.end(pred), opts);
    return;
  }
  let found = false;
  tx.rewrite(h => {
    if (h.id !== site.target) return;
    found = true;
    const v = st.get(h.id) as ValueRec;
    const [a, b] = v.args;
    switch (site.operator) {
      case 'const':
        return tx.const(((v.imm as number) + (site.variant === '+1' ? 1 : -1)) | 0, opts);
      case 'cmp-flip':
      case 'cmp-weaken':
        return tx.make(site.variant as ValueOp, a, b, opts);
      case 'swap':
        return tx.make(v.op, b, a, { ...opts, ...(v.type ? { type: v.type } : {}) });
      case 'shift': {
        if (site.variant === 'shr' || site.variant === 'shru')
          return tx.make(site.variant as ValueOp, a, b, opts);
        const k = (st.get(b) as ValueRec).imm as number;
        return tx.make(v.op, a, tx.const(k + (site.variant === 'k+1' ? 1 : -1), opts), opts);
      }
      case 'drop-check':
        // caddr(r, p) -> r + (p << 1): the address without the capacity check
        return tx.make('add', a, tx.make('shl', b, tx.const(1, opts), opts), opts);
      case 'check-range': {
        if (v.op !== 'caddr')
          // the length of a branch-form check, one too large: the check admits index = length
          return tx.make('add', h.id, tx.const(1, opts), opts);
        // caddr(r, p) checking p <= cap: d = (p != 0); caddr(r, p - d) + 2d (same address; p = 0 unchanged)
        const d1 = tx.make('ne', copyTree(tx, st, b), tx.const(0, opts), opts);
        const d2 = tx.make('ne', copyTree(tx, st, b), tx.const(0, opts), opts);
        const checked = tx.make('caddr', a, tx.make('sub', b, d1, opts), opts);
        return tx.make('add', checked, tx.make('shl', d2, tx.const(1, opts), opts), opts);
      }
      case 'f32': {
        if (v.op === 'const') {
          const bits = v.imm as number;
          return tx.const(site.variant === 'sign' ? bits ^ -0x80000000 : (bits + 1) | 0, {
            ...opts,
            type: 'f32',
          });
        }
        return tx.make(site.variant as ValueOp, ...v.args, opts);
      }
    }
    throw new TxError('unsupported', `mutant: ${site.operator} is not a value operator`);
  });
  if (!found) throw new TxError('absent', `mutant: no value ${site.target} in ${f.name}`);
}

/**
 * `typed.mutant`: applies `params.site` to its function and nothing else. Declares every write kind, since the
 * operators between them change values, statements and control flow; claims to preserve nothing.
 */
export const mutantPass: TypedPass = typedPass({
  name: 'mutant',
  about: 'applies one mutation (params.site) to one function: a deliberately wrong revision',
  writes: ['values', 'stmts', 'locals', 'cfg'],
  preserves: [],
  body({ st, f, tx, params }) {
    const site = params.site as MutationSite | undefined;
    if (!site) throw new TxError('unsupported', 'mutant needs params.site');
    if (f.name === site.fn) applyMutation(st, f, tx, site);
  },
});

// ---------- what classifying a mutant needs ----------

/** The functions each function calls directly. */
export function callGraph(st: Store): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const f of st.fns.values()) {
    const callees = new Set<string>();
    const walk = (id: string | undefined) => {
      if (!id) return;
      const v = st.get(id) as ValueRec;
      if (v.op === 'call') callees.add(v.imm as string);
      v.args.forEach(walk);
    };
    for (const b of f.blocks)
      for (const sid of b.stmts) {
        const s = st.get(sid) as StmtRec;
        walk(s.value);
        walk(s.cond);
        walk(s.addr);
      }
    out.set(f.name, callees);
  }
  return out;
}

/**
 * The functions whose runs can observe a change to `fn`: `fn` and every function that reaches it through calls.
 * Every other function executes only unchanged code, so its cases have the base's outcomes.
 */
export function affected(st: Store, fn: string): string[] {
  const graph = callGraph(st),
    out = new Set([fn]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [g, callees] of graph)
      if (!out.has(g) && [...callees].some(c => out.has(c))) {
        out.add(g);
        grew = true;
      }
  }
  return [...st.fns.keys()].filter(g => out.has(g));
}

/** One finite parameter domain: its size, and its i-th value written into a case's memory. */
interface Domain {
  readonly size: number;
  at(i: number, mem: Memory, name: string): number;
}
const ints = (values: readonly number[]): Domain => ({ size: values.length, at: i => values[i] | 0 });
const range = (lo: number, hi: number): Domain => ({ size: hi - lo + 1, at: i => (lo + i) | 0 });

function domainOf(spec: any, type: string, records: any, enums: any, budget: number): Domain | null {
  if (type === 'f32') return null;
  if (typeof spec === 'number') return ints([spec]);
  if (Array.isArray(spec)) return spec[1] - spec[0] + 1 <= budget ? range(spec[0], spec[1]) : null;
  if (spec && spec.cells) {
    const cells = spec.cells as number[];
    return { size: 1, at: (_i, mem, name) => mem.buffer(cells, name) };
  }
  if (spec && spec.string !== undefined)
    return { size: 1, at: (_i, mem, name) => mem.string(spec.string as string, name) };
  if (spec && spec.buffer) {
    const [a, b] = spec.buffer as [number, number],
      [c0, c1] = (spec.cell as [number, number]) ?? [0, 255];
    const k = c1 - c0 + 1;
    let size = 0;
    const offsets: number[] = [];
    for (let len = a; len <= b; len++) {
      offsets.push(size);
      size += k ** len;
      if (size > budget) return null;
    }
    return {
      size,
      at(i, mem, name) {
        let len = a;
        while (len < b && offsets[len - a + 1] <= i) len++;
        let r = i - offsets[len - a];
        const cells: number[] = [];
        for (let j = 0; j < len; j++) {
          cells.push(c0 + (r % k));
          r = Math.floor(r / k);
        }
        return mem.buffer(cells, name);
      },
    };
  }
  if (spec && spec.floats) return null;
  if (spec && spec.bool) return ints([0, 1]);
  if (spec && spec.record) {
    const layout = (records[type] ?? {}) as Record<string, { type: string }>;
    const fields = Object.entries(layout).map(([field, f]) =>
      domainOf(spec.record[field] ?? [-50, 50], f.type, records, enums, budget),
    );
    if (fields.some(d => !d)) return null;
    const size = fields.reduce((n, d) => n * d!.size, 1);
    if (size > budget) return null;
    const names = Object.keys(layout);
    return {
      size,
      at(i, mem, name) {
        const words = fields.map((d, j) => {
          const x = i % d!.size;
          i = Math.floor(i / d!.size);
          return d!.at(x, mem, name + '.' + names[j]);
        });
        return mem.record(words, name);
      },
    };
  }
  if (spec && spec.oneOf) return ints(spec.oneOf as number[]);
  if (type === 'bool') return ints([0, 1]);
  if (records[type]) return domainOf({ record: {} }, type, records, enums, budget);
  if (enums[type]) return ints(Object.values(enums[type] as Record<string, number>));
  return null; // an unspecified i32, buffer or string: not finite for this purpose
}

/**
 * Every input of `fname` its specification allows, as cases in the generator's memory layout (parameters allocated
 * in order), or null when the domain is infinite (an f32, an unspecified integer or buffer) or larger than `budget`.
 */
export function finiteDomain(
  st: Store,
  fname: string,
  inputs: FunctionInputs,
  budget: number,
): Case[] | null {
  const f = st.fn(fname);
  const records = (st.frontEnd.records as Record<string, unknown>) ?? {},
    enums = (st.frontEnd.enums as Record<string, unknown>) ?? {};
  const doms: Domain[] = [];
  for (let i = 0; i < f.params.length; i++) {
    const d = domainOf(inputs[f.locals[i].name], f.params[i], records, enums, budget);
    if (!d) return null;
    doms.push(d);
  }
  const size = doms.reduce((n, d) => n * d.size, 1);
  if (size > budget) return null;
  const out: Case[] = [];
  for (let n = 0; n < size; n++) {
    const mem = new Memory();
    let r = n;
    const args = doms.map((d, i) => {
      const x = r % d.size;
      r = Math.floor(r / d.size);
      return d.at(x, mem, f.locals[i].name);
    });
    out.push({ fn: fname, n, args, memory: mem.image(), items: mem.items.slice() });
  }
  return out;
}

export interface Comparison {
  readonly total: number;
  readonly agree: number;
  readonly disagree: number;
  readonly inconclusive: number;
  /** Cases where the subject hit the limit while the baseline finished within `divergeBelow` steps. */
  readonly diverge: number;
  readonly witness?: {
    readonly fn: string;
    readonly n: number;
    readonly args: readonly number[];
    readonly reason: string;
  };
}

/**
 * Compare `subject` with `baseline` on `cases` with the gate's verdict rules (`agrees`; a limit on either side is
 * inconclusive). `divergeBelow` marks a subject that hit the limit where the baseline needed fewer steps: a
 * mutant that does not terminate where the original does is wrong, although the gate counts the case as no verdict.
 */
export function compareOn(
  baseline: Store,
  subject: Store,
  cases: readonly Case[],
  opts: {
    limit?: number;
    divergeBelow?: number;
    stopAtWitness?: boolean;
    /** The baseline's runs on `cases`, when already computed (the origin is the same for every mutant). */
    baselineRuns?: readonly RunResult[];
  } = {},
): Comparison {
  const limit = opts.limit ?? 2e5,
    below = opts.divergeBelow ?? 2e4;
  let agree = 0,
    disagree = 0,
    inconclusive = 0,
    diverge = 0;
  let witness: Comparison['witness'];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const a: RunResult = opts.baselineRuns?.[i] ?? evaluate(baseline, c.fn, c.args, c.memory, { limit });
    if (a.limit) {
      inconclusive++; // no verdict whatever the subject does
      continue;
    }
    const b: RunResult = evaluate(subject, c.fn, c.args, c.memory, { limit });
    if (a.limit || b.limit) {
      inconclusive++;
      if (!a.limit && b.limit && a.steps <= below) {
        diverge++;
        witness ??= {
          fn: c.fn,
          n: c.n,
          args: c.args,
          reason: `diverges: limit ${limit}, baseline ${a.steps} steps`,
        };
        if (opts.stopAtWitness) break;
      }
      continue;
    }
    if (agrees(a, b)) agree++;
    else {
      disagree++;
      witness ??= {
        fn: c.fn,
        n: c.n,
        args: c.args,
        reason: `expected ${a.trap ? 'trap' : String(a.result)}, got ${b.trap ? 'trap' : String(b.result)}`,
      };
      if (opts.stopAtWitness) break;
    }
  }
  return { total: cases.length, agree, disagree, inconclusive, diverge, ...(witness ? { witness } : {}) };
}

/** `fns` and every function they call, transitively, in program order. */
export function closure(st: Store, fns: readonly string[]): string[] {
  const graph = callGraph(st),
    out = new Set(fns),
    todo = [...fns];
  while (todo.length)
    for (const c of graph.get(todo.pop()!) ?? []) if (!out.has(c)) (out.add(c), todo.push(c));
  return [...st.fns.keys()].filter(g => out.has(g));
}

/**
 * The program restricted to `fns`, which must be closed under calls (see `closure`): the same records, filtered by
 * function. Evaluating a function of `fns` on it gives exactly the run on the whole program, so a large program's
 * mutants can be judged on the sub-program that contains the mutated function, the functions reaching it, and
 * everything they call.
 */
export function subProgram(v: TypedBlocks, fns: readonly string[]): TypedBlocks {
  const keep = new Set(fns),
    ids = new Set(fns.map(n => v.fns[n].id));
  const pick = <T extends { fn: string }>(table: Readonly<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(Object.entries(table).filter(([, e]) => ids.has(e.fn)));
  return {
    ...v,
    fnOrder: v.fnOrder.filter(n => keep.has(n)),
    fns: Object.fromEntries(Object.entries(v.fns).filter(([n]) => keep.has(n))),
    blocks: pick(v.blocks),
    stmts: pick(v.stmts),
    values: pick(v.values),
    ops: pick(v.ops),
  };
}
