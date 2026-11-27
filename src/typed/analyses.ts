/**
 * Facts about `typed.blocks`, as v6 analyses: computed per exact revision, cached by the analysis manager, and
 * checked when a pass claims to preserve them. A port of Compiler Workbench's analyses.js.
 *
 *   typed.cfg         successors, predecessors, reverse postorder            (defineAnalysis)
 *   typed.dominators  immediate dominators (Cooper, Harvey and Kennedy)       (defineAnalysis)
 *   typed.loops       natural loops, preheaders, assigned locals            (defineAnalysis)
 *   typed.liveness    locals live into/out of each block                     (dataflow, backward, set lattice)
 *   typed.reaching    reaching definitions                                   (dataflow, forward, set lattice)
 *   typed.ranges      an interval per local, branch refinement, widening    (dataflow, forward, map(interval))
 *
 * Results are finite JSON keyed by function name. Pass code reads them through views (`liveView`, `reachView`,
 * `rangeView`, `domView`) that rebuild Compiler Workbench's query methods (liveAfter, reachingAt, ranges.at/of,
 * dominates) from the stored block facts. The three dataflow analyses use the round-robin schedule and, for
 * ranges, widening after three visits of a loop head, as the prototype does, so their facts are the prototype's.
 */
import { defineAnalysis, defineType } from '../framework/contracts/definitions.js';
import { canonical } from '../framework/core/data.js';
import { dataflow, type DataflowResult, type FlowRegion } from '../framework/dataflow/analysis.js';
import { intervalLattice, mapLattice, setLattice, type Interval } from '../framework/dataflow/lattices.js';
import type { FlowGraph } from '../framework/dataflow/solver.js';
import { BlocksIR, blocksAdapter, storeOf } from './ir.js';
import type { BlockRec, StmtRec, Store, TypedBlocks, ValueRec, WorkFn } from './model.js';

export const MIN = -2147483648,
  MAX = 2147483647;

// ---------- helpers over value trees ----------
export function readsOf(st: Store, id: string | undefined, acc = new Set<number>()): Set<number> {
  if (!id) return acc;
  const v = st.get(id) as ValueRec;
  if (v.op === 'get') acc.add(v.imm as number);
  for (const a of v.args) readsOf(st, a, acc);
  return acc;
}
/**
 * Whether evaluating a value may do something besides producing it (call, read memory, trap), so it cannot be
 * dropped: calls, loads, divisions, and checked addresses (a capacity load and a trap). A result leaf has no effect.
 */
export function hasEffect(st: Store, id: string | undefined): boolean {
  if (!id) return false;
  const v = st.get(id) as ValueRec;
  return (
    v.op === 'call' ||
    v.op === 'load' ||
    v.op === 'load16u' ||
    v.op === 'div' ||
    v.op === 'rem' ||
    v.op === 'caddr' ||
    v.args.some(a => hasEffect(st, a))
  );
}
/**
 * Whether a value is a function of its operands alone, so it may be computed elsewhere or once (lvn, licm, subst):
 * not a call, a load, a division (it may trap), a checked address (it traps and reads memory), or a result leaf (it
 * reads the latest call's results). The f32 operators are pure: the target rounds to nearest even statically and
 * raises no traps.
 */
export function isPure(st: Store, id: string): boolean {
  const v = st.get(id) as ValueRec;
  if (IMPURE.has(v.op)) return false;
  return v.args.every(a => isPure(st, a));
}
export const IMPURE = new Set(['call', 'load', 'load16u', 'div', 'rem', 'caddr', 'result']);
export const stmtValues = (s: StmtRec): string[] => [s.value, s.cond, s.addr].filter((x): x is string => !!x);

// ---------- cfg ----------
export interface Cfg {
  readonly entry: string;
  readonly succ: Readonly<Record<string, readonly string[]>>;
  readonly preds: Readonly<Record<string, readonly string[]>>;
  readonly rpo: readonly string[];
  readonly edges: number;
}
export function cfgOf(f: WorkFn): Cfg {
  const succ: Record<string, string[]> = {},
    preds: Record<string, string[]> = {};
  for (const b of f.blocks) {
    succ[b.id] = b.succ.slice();
    preds[b.id] = [];
  }
  for (const b of f.blocks) for (const s of b.succ) if (preds[s]) preds[s].push(b.id);
  const order: string[] = [],
    seen = new Set<string>();
  const dfs = (id: string) => {
    if (seen.has(id) || !succ[id]) return;
    seen.add(id);
    for (const s of succ[id]) dfs(s);
    order.push(id);
  };
  dfs(f.blocks[0].id);
  return {
    entry: f.blocks[0].id,
    succ,
    preds,
    rpo: order.reverse(),
    edges: f.blocks.reduce((n, b) => n + b.succ.length, 0),
  };
}
export const flowGraph = (f: WorkFn): FlowGraph => {
  const c = cfgOf(f);
  return {
    entry: c.entry,
    blocks: f.blocks.map(b => b.id),
    succ: b => (c.succ[b] ?? []).filter(s => c.succ[s]),
    preds: b => c.preds[b] ?? [],
  };
};

const JsonFacts = defineType<Readonly<Record<string, unknown>>>({
  id: 'typed.facts',
  version: '1',
  description: 'per-function facts as finite JSON',
  validate(v) {
    canonical(v); // throws on values that are not finite JSON
    if (!v || typeof v !== 'object') throw new Error('facts must be an object keyed by function');
  },
});

const perFunction = <R>(v: TypedBlocks, f: (fn: WorkFn, st: Store) => R): Record<string, R> => {
  const st = storeOf(v);
  return Object.fromEntries([...st.fns.values()].map(fn => [fn.name, f(fn, st)]));
};

export const cfgAnalysis = defineAnalysis({
  id: 'typed.cfg',
  version: '1',
  description: 'successors, predecessors and reverse postorder',
  input: BlocksIR,
  output: JsonFacts,
  run: (_ctx, a) => perFunction(a.value, f => cfgOf(f)),
});

// ---------- dominators ----------
export interface Dominators {
  readonly idom: Readonly<Record<string, string | null>>;
  readonly rpo: readonly string[];
  readonly rounds: number;
}
export function dominatorsOf(f: WorkFn): Dominators {
  const cfg = cfgOf(f),
    rpo = cfg.rpo,
    idx = new Map(rpo.map((id, i) => [id, i]));
  const idom = new Map<string, string | null>([[rpo[0], rpo[0]]]);
  const inter = (a: string, b: string) => {
    while (a !== b) {
      while (idx.get(a)! > idx.get(b)!) a = idom.get(a)!;
      while (idx.get(b)! > idx.get(a)!) b = idom.get(b)!;
    }
    return a;
  };
  let changed = true,
    rounds = 0;
  while (changed) {
    changed = false;
    rounds++;
    for (const id of rpo.slice(1)) {
      let n: string | null = null;
      for (const q of cfg.preds[id])
        if (idom.has(q) && idom.get(q) !== undefined && idx.has(q)) n = n === null ? q : inter(q, n);
      if (idom.get(id) !== n) {
        idom.set(id, n);
        changed = true;
      }
    }
  }
  return { idom: Object.fromEntries(idom), rpo, rounds };
}
export interface DomView {
  readonly idom: ReadonlyMap<string, string | null>;
  dominates(a: string, b: string): boolean;
  readonly children: ReadonlyMap<string, string[]>;
}
export function domView(d: Dominators): DomView {
  const idom = new Map(Object.entries(d.idom));
  const dominates = (a: string, b: string) => {
    for (;;) {
      if (a === b) return true;
      const x = idom.get(b);
      if (!x || x === b) return false;
      b = x;
    }
  };
  const children = new Map(d.rpo.map(id => [id, [] as string[]]));
  for (const [b, x] of idom) if (x && b !== x) children.get(x)?.push(b);
  return { idom, dominates, children };
}
export const dominatorsAnalysis = defineAnalysis({
  id: 'typed.dominators',
  version: '1',
  description: 'immediate dominators (Cooper, Harvey and Kennedy)',
  input: BlocksIR,
  output: JsonFacts,
  run: (_ctx, a) => perFunction(a.value, f => dominatorsOf(f)),
});

// ---------- loops ----------
export interface Loop {
  readonly id: string;
  readonly head: string;
  readonly latch: string;
  readonly body: readonly string[];
  readonly preheader: string | null;
  readonly exits: readonly string[];
  readonly assigned: readonly number[];
}
export function loopsOf(st: Store, f: WorkFn): Loop[] {
  const dom = domView(dominatorsOf(f)),
    cfg = cfgOf(f),
    out: Loop[] = [];
  for (const b of f.blocks)
    for (const s of b.succ)
      if (dom.dominates(s, b.id)) {
        const body = new Set([s]),
          work = [b.id];
        while (work.length) {
          const x = work.pop()!;
          if (body.has(x)) continue;
          body.add(x);
          work.push(...cfg.preds[x]);
        }
        const outside = cfg.preds[s].filter(q => !body.has(q));
        const pre = outside.length === 1 && cfg.succ[outside[0]].length === 1 ? outside[0] : null;
        const exits = [...body].flatMap(x => cfg.succ[x].filter(y => !body.has(y)));
        const assigned = new Set<number>();
        for (const x of body)
          for (const sid of (st.get(x) as BlockRec).stmts) {
            const t = st.get(sid) as StmtRec;
            if (t.op === 'set') assigned.add(t.local!);
          }
        out.push({
          id: `loop:${f.name}@${s}`,
          head: s,
          latch: b.id,
          body: [...body],
          preheader: pre,
          exits: [...new Set(exits)],
          assigned: [...assigned],
        });
      }
  return out;
}
export const loopsAnalysis = defineAnalysis({
  id: 'typed.loops',
  version: '1',
  description: 'natural loops from back edges, with preheaders and assigned locals',
  input: BlocksIR,
  output: JsonFacts,
  run: (_ctx, a) => perFunction(a.value, (f, st) => loopsOf(st, f)),
});

// ---------- dataflow analyses ----------
interface FnContext {
  readonly st: Store;
  readonly f: WorkFn;
}
const regions = (view: { artifact: { value: TypedBlocks } }): (FlowRegion & { context: FnContext })[] => {
  const st = storeOf(view.artifact.value);
  return [...st.fns.values()].map(f => ({ id: f.name, graph: flowGraph(f), context: { st, f } }));
};
const READS_ALL = {
  entities: ['block', 'stmt.*', 'value.*', 'local'],
  relations: ['contains', 'succ', 'jump', 'uses', 'operand', 'reads', 'writes', 'declares'],
};
const READS_CONTROL_STMTS = {
  entities: ['block', 'stmt.*', 'local'],
  relations: ['contains', 'succ', 'jump', 'writes', 'declares'],
};

// liveness
const useDef = (st: Store, b: BlockRec) => {
  const u = new Set<number>(),
    d = new Set<number>();
  for (const sid of b.stmts) {
    const s = st.get(sid) as StmtRec;
    for (const v of stmtValues(s)) for (const l of readsOf(st, v)) if (!d.has(l)) u.add(l);
    if (s.op === 'set') d.add(s.local!);
  }
  return { u, d };
};
export const livenessAnalysis = dataflow<TypedBlocks, ReadonlySet<number>, FnContext>({
  id: 'typed.liveness',
  version: '1',
  description: 'locals live into and out of each block',
  input: BlocksIR,
  adapter: blocksAdapter,
  direction: 'backward',
  lattice: setLattice<number>(),
  strategy: 'round-robin',
  regions: view => regions(view as never),
  transfer(block, out, { st }) {
    const { u, d } = useDef(st, st.get(block));
    const s = new Set(u);
    for (const l of out) if (!d.has(l)) s.add(l);
    return s;
  },
  reads: READS_ALL,
});
export interface LiveView {
  liveIn(block: string): ReadonlySet<number>;
  liveOut(block: string): ReadonlySet<number>;
  liveAfter(stmt: string): ReadonlySet<number>;
  names(set: Iterable<number>): string[];
}
export function liveView(result: DataflowResult, st: Store, fname: string): LiveView {
  const r = result.regions[fname],
    f = st.fn(fname);
  const dec = (j: unknown) => new Set((j as number[] | undefined) ?? []);
  const after = new Map<string, Set<number>>();
  for (const b of f.blocks) {
    const now = dec(r.out[b.id]);
    for (let i = b.stmts.length - 1; i >= 0; i--) {
      const s = st.get(b.stmts[i]) as StmtRec;
      after.set(s.id, new Set(now));
      if (s.op === 'set') now.delete(s.local!);
      for (const v of stmtValues(s)) for (const l of readsOf(st, v)) now.add(l);
    }
  }
  return {
    liveIn: b => dec(r.in[b]),
    liveOut: b => dec(r.out[b]),
    liveAfter: sid => after.get(sid) ?? new Set(),
    names: set => [...set].map(l => f.locals[l].name),
  };
}

// reaching definitions: definition ids are statement ids, or `param:i` / `init:i` for a local's value at entry
const defLocal = (st: Store, d: string) =>
  d.startsWith('param:') || d.startsWith('init:') ? +d.split(':')[1] : (st.get(d) as StmtRec).local!;
const reachStep = (st: Store, now: Set<string>, sid: string) => {
  const s = st.get(sid) as StmtRec;
  if (s.op === 'set') {
    for (const d of [...now]) if (defLocal(st, d) === s.local) now.delete(d);
    now.add(sid);
  }
};
export const reachingAnalysis = dataflow<TypedBlocks, ReadonlySet<string>, FnContext>({
  id: 'typed.reaching',
  version: '1',
  description: 'reaching definitions: which assignments reach each read',
  input: BlocksIR,
  adapter: blocksAdapter,
  direction: 'forward',
  lattice: setLattice<string>(),
  strategy: 'round-robin',
  regions: view => regions(view as never),
  boundary: (_r, { f }) => new Set(f.locals.map((l, i) => (l.param ? 'param:' : 'init:') + i)),
  transfer(block, inn, { st }) {
    const s = new Set(inn);
    for (const sid of (st.get(block) as BlockRec).stmts) reachStep(st, s, sid);
    return s;
  },
  reads: READS_CONTROL_STMTS,
});
export interface ReachView {
  /** Definitions of local `l` that reach statement `sid` (before it executes). */
  reachingAt(sid: string, l: number): string[];
  defsOf(l: number): string[];
}
export function reachView(result: DataflowResult, st: Store, fname: string): ReachView {
  const r = result.regions[fname],
    f = st.fn(fname);
  const before = new Map<string, Set<string>>(),
    defs = new Map<number, string[]>();
  for (const b of f.blocks) {
    const now = new Set((r.in[b.id] as string[] | undefined) ?? []);
    for (const sid of b.stmts) {
      before.set(sid, new Set(now));
      reachStep(st, now, sid);
      const s = st.get(sid) as StmtRec;
      if (s.op === 'set') defs.set(s.local!, [...(defs.get(s.local!) ?? []), sid]);
    }
  }
  return {
    reachingAt: (sid, l) => [...(before.get(sid) ?? [])].filter(d => defLocal(st, d) === l),
    defsOf: l => defs.get(l) ?? [],
  };
}

// ranges
type Env = ReadonlyMap<string, Interval>;
export function evalRange(st: Store, id: string, env: Env): [number, number] {
  const v = st.get(id) as ValueRec,
    I = (lo: number, hi: number): [number, number] => [Math.max(MIN, lo), Math.min(MAX, hi)];
  const full: [number, number] = [MIN, MAX];
  if (v.type === 'f32') return full; // ranges are of i32s; an f32 local has no interval
  switch (v.op) {
    case 'feq':
    case 'fne':
    case 'flt':
    case 'fgt':
    case 'fle':
    case 'fge':
      return [0, 1];
    case 'const':
      return [v.imm as number, v.imm as number];
    case 'get': {
      const r = env.get(String(v.imm));
      return r ? [r[0], r[1]] : full;
    }
    case 'eqz':
    case 'eq':
    case 'ne':
    case 'lt':
    case 'gt':
    case 'le':
    case 'ge':
    case 'ltu':
    case 'geu':
      return [0, 1];
    case 'load16u':
      return [0, 65535];
  }
  if (v.args.length !== 2) return full;
  const a = evalRange(st, v.args[0], env),
    b = evalRange(st, v.args[1], env);
  const fits = (lo: number, hi: number): [number, number] => (lo >= MIN && hi <= MAX ? [lo, hi] : full);
  switch (v.op) {
    case 'add':
      return fits(a[0] + b[0], a[1] + b[1]);
    case 'sub':
      return fits(a[0] - b[1], a[1] - b[0]);
    case 'mul': {
      const c = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]];
      return fits(Math.min(...c), Math.max(...c));
    }
    case 'shl':
      return b[0] === b[1] && b[0] >= 0 && b[0] < 31 ? fits(a[0] * 2 ** b[0], a[1] * 2 ** b[0]) : full;
    case 'shr':
      return b[0] === b[1] && b[0] >= 0 ? [a[0] >> b[0], a[1] >> b[0]] : full;
    case 'div':
      return b[0] > 0 ? I(Math.min(Math.trunc(a[0] / b[0]), 0), Math.max(Math.trunc(a[1] / b[0]), 0)) : full;
    case 'rem':
      return b[0] > 0 ? I(a[0] < 0 ? -(b[1] - 1) : 0, a[1] < 0 ? 0 : b[1] - 1) : full;
    case 'and':
      return a[0] >= 0 || b[0] >= 0 ? [0, Math.min(a[0] >= 0 ? a[1] : MAX, b[0] >= 0 ? b[1] : MAX)] : full;
  }
  return full;
}
function refine(st: Store, cond: string, env: Env, taken: boolean): Env {
  const v = st.get(cond) as ValueRec;
  if (v.op === 'eqz') return refine(st, v.args[0], env, !taken);
  if (!['lt', 'le', 'gt', 'ge'].includes(v.op)) return env;
  const [x, y] = v.args.map(a => st.get(a) as ValueRec);
  let op = v.op as string;
  const flip: Record<string, string> = { lt: 'gt', gt: 'lt', le: 'ge', ge: 'le' },
    neg: Record<string, string> = { lt: 'ge', ge: 'lt', le: 'gt', gt: 'le' };
  if (!taken) op = neg[op];
  const m = new Map(env);
  const narrow = (local: string, op: string, r: [number, number]) => {
    const cur = m.get(local) || [MIN, MAX];
    let [lo, hi] = cur;
    if (op === 'lt') hi = Math.min(hi, r[1] - 1);
    if (op === 'le') hi = Math.min(hi, r[1]);
    if (op === 'gt') lo = Math.max(lo, r[0] + 1);
    if (op === 'ge') lo = Math.max(lo, r[0]);
    m.set(local, lo > hi ? [lo, lo] : [lo, hi]);
  };
  if (x.op === 'get') narrow(String(x.imm), op, evalRange(st, y.id, env));
  if (y.op === 'get') narrow(String(y.imm), flip[op], evalRange(st, x.id, env));
  return m;
}
const rangeStep = (st: Store, env: Env, sid: string): Env => {
  const s = st.get(sid) as StmtRec;
  if (s.op !== 'set') return env;
  const m = new Map(env);
  m.set(String(s.local), evalRange(st, s.value!, env));
  return m;
};
const interval = intervalLattice();
export const rangesAnalysis = dataflow<TypedBlocks, ReadonlyMap<string, Interval>, FnContext>({
  id: 'typed.ranges',
  version: '1',
  description: 'an interval for each local at each statement, with branch refinement and widening',
  input: BlocksIR,
  adapter: blocksAdapter,
  direction: 'forward',
  lattice: mapLattice<string, Interval>(interval),
  strategy: 'round-robin',
  widenAfter: 3,
  regions: view => regions(view as never),
  boundary: (_r, { f }) =>
    new Map(
      f.locals.map((l, i) => [
        String(i),
        (l.param ? (l.type === 'bool' ? [0, 1] : [MIN, MAX]) : [0, 0]) as Interval,
      ]),
    ),
  transfer: (block, inn, { st }) =>
    (st.get(block) as BlockRec).stmts.reduce((env, sid) => rangeStep(st, env, sid), inn),
  edge(from, to, out, { st }) {
    const b = st.get(from) as BlockRec,
      last = st.get(b.stmts.at(-1)!) as StmtRec | undefined;
    if (last && last.op === 'br_if' && last.then !== last.else)
      return refine(st, last.cond!, out, last.then === to);
    return out;
  },
  widen(a, b) {
    const m = new Map(b);
    for (const [k, v] of b) if (a.has(k)) m.set(k, interval.widen(a.get(k)!, v));
    return m;
  },
  reads: READS_ALL,
});
export interface RangeView {
  /** The interval of local `l` just before statement `sid`. */
  at(sid: string, l: number): [number, number];
  /** The interval of value `valueId` evaluated just before statement `sid`. */
  of(sid: string, valueId: string): [number, number];
}
export function rangeView(result: DataflowResult, st: Store, fname: string): RangeView {
  const r = result.regions[fname],
    f = st.fn(fname);
  const before = new Map<string, Env>();
  const decode = (j: unknown): Env =>
    new Map(
      Object.entries((j as Record<string, [number, number]> | undefined) ?? {}).map(([k, v]) => [
        k,
        [v[0], v[1]] as Interval,
      ]),
    );
  for (const b of f.blocks) {
    let env = decode(r.in[b.id]);
    for (const sid of b.stmts) {
      before.set(sid, env);
      env = rangeStep(st, env, sid);
    }
  }
  return {
    at: (sid, l) => {
      const x = before.get(sid)?.get(String(l));
      return x ? [x[0], x[1]] : [MIN, MAX];
    },
    of: (sid, valueId) => evalRange(st, valueId, before.get(sid) ?? new Map()),
  };
}

/** All analyses by their Compiler Workbench names (for `needs: { live: 'liveness' }` style lookups). */
export const ANALYSES = {
  cfg: cfgAnalysis,
  dominators: dominatorsAnalysis,
  loops: loopsAnalysis,
  liveness: livenessAnalysis,
  reaching: reachingAnalysis,
  ranges: rangesAnalysis,
} as const;
