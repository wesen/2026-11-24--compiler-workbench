/**
 * A single-assignment view of `typed.blocks` (IRWB-006, agenda item A1): a fact about a revision, not a new IR.
 *
 * The construction is Cytron, Ferrante, Rosen, Wegman and Zadeck's: the dominator tree (from `dominatorsOf`),
 * dominance frontiers (Cooper, Harvey and Kennedy's runner), phis for each local at the iterated frontier of its
 * `set` statements (minimal SSA: no liveness), and renaming by a preorder walk of the dominator tree with a stack of
 * names per local. Every local also has a definition at function entry (`param:i` or `init:i`, as in reaching
 * definitions), placed in a virtual block `^entry` that immediately dominates the real entry and has one edge to it;
 * so a loop whose header is the entry block gets phis like any other join.
 *
 * Names are `<local>.<n>` (a `.` cannot occur in a Typed identifier), numbered per local in the order the walk
 * creates them, `.0` being the entry definition; a local whose name another local of the function shares is
 * `<local>#<index>.<n>`. The result maps every SSA name back to what defines it (a `set`
 * statement and its value tree, an entry definition, or a phi: a block and a local), every `get` value to the name
 * it reads, and every `set` statement to the name it defines. `checkSsa` validates it against reaching definitions.
 */
import { defineAnalysis, defineType } from '../framework/contracts/definitions.js';
import { canonical } from '../framework/core/data.js';
import { dominators } from '../stdlib/graph/dominators.js';
import { cfgOf, digraphOf, stmtValues, type LiveView, type ReachView } from './analyses.js';
import { BlocksIR, storeOf } from './ir.js';
import type { BlockRec, StmtRec, Store, TypedBlocks, ValueRec, WorkFn } from './model.js';

export const VIRTUAL_ENTRY = '^entry';

export interface SsaDef {
  readonly local: number;
  readonly kind: 'param' | 'init' | 'set' | 'phi';
  /** The block of the definition: '^entry' for param and init, the join block for a phi. */
  readonly block: string;
  /** kind 'set': the statement and the value tree it assigns. */
  readonly stmt?: string;
  readonly value?: string;
  /** The definition's id in reaching definitions: 'param:i', 'init:i' or the statement id (absent for a phi). */
  readonly def?: string;
}
export interface SsaPhi {
  readonly name: string;
  readonly local: number;
  /** Predecessor block (or '^entry') -> the name that reaches the end of it. */
  readonly args: Readonly<Record<string, string>>;
}
export interface SsaFn {
  readonly entry: string;
  readonly names: Readonly<Record<string, SsaDef>>;
  /** Block -> its phis, ordered by local index. */
  readonly phis: Readonly<Record<string, readonly SsaPhi[]>>;
  /** Every `get` value id in a reachable block -> the name it reads. */
  readonly uses: Readonly<Record<string, string>>;
  /** Every `set` statement id in a reachable block -> the name it defines. */
  readonly defs: Readonly<Record<string, string>>;
  /** Block -> immediate dominator ('^entry' for the entry block). */
  readonly idom: Readonly<Record<string, string>>;
  /** Block -> its dominance frontier (blocks in reverse postorder). */
  readonly frontier: Readonly<Record<string, readonly string[]>>;
  /** The blocks the dominator tree does not reach (no names, no uses). */
  readonly unreachable: readonly string[];
}

/** The SSA form of one function of a working store. */
export function ssaOf(st: Store, f: WorkFn): SsaFn {
  const cfg = cfgOf(f),
    entry = cfg.entry,
    rpo = cfg.rpo,
    reachable = new Set(rpo);
  const position = new Map(rpo.map((b, i) => [b, i]));
  const d = dominators(digraphOf(f));
  const idom = new Map<string, string>();
  for (const b of rpo) idom.set(b, b === entry ? VIRTUAL_ENTRY : d.idom.get(b)!);
  const preds = (b: string): string[] => [
    ...(b === entry ? [VIRTUAL_ENTRY] : []),
    ...new Set((cfg.preds[b] ?? []).filter(p => reachable.has(p))),
  ];
  const succs = (b: string): string[] => [...new Set((cfg.succ[b] ?? []).filter(s => reachable.has(s)))];

  // dominance frontiers: for each join Y, climb from each predecessor to idom(Y)
  const df = new Map<string, Set<string>>([[VIRTUAL_ENTRY, new Set()]]);
  for (const b of rpo) df.set(b, new Set());
  for (const y of rpo) {
    const ps = preds(y);
    if (ps.length < 2) continue;
    for (const p of ps) {
      let runner = p;
      while (runner !== idom.get(y)) {
        df.get(runner)!.add(y);
        if (runner === VIRTUAL_ENTRY) break; // only reached if idom(y) is not on the path: cannot happen
        runner = idom.get(runner)!;
      }
    }
  }

  // phi placement at the iterated frontier of each local's `set` blocks
  const defBlocks = new Map<number, Set<string>>();
  for (const b of rpo)
    for (const sid of (st.get(b) as BlockRec).stmts) {
      const s = st.get(sid) as StmtRec;
      if (s.op === 'set') {
        if (!defBlocks.has(s.local!)) defBlocks.set(s.local!, new Set());
        defBlocks.get(s.local!)!.add(b);
      }
    }
  const phiLocals = new Map<string, Set<number>>();
  for (const [l, blocks] of defBlocks) {
    const work = [...blocks],
      placed = new Set<string>();
    while (work.length) {
      const x = work.pop()!;
      for (const y of df.get(x)!) {
        if (placed.has(y)) continue;
        placed.add(y);
        if (!phiLocals.has(y)) phiLocals.set(y, new Set());
        phiLocals.get(y)!.add(l);
        if (!blocks.has(y)) work.push(y);
      }
    }
  }
  const phiRecs = new Map<string, { name: string; local: number; args: Record<string, string> }[]>();
  for (const b of rpo)
    if (phiLocals.has(b))
      phiRecs.set(
        b,
        [...phiLocals.get(b)!].sort((x, y) => x - y).map(local => ({ name: '', local, args: {} })),
      );

  // renaming: a preorder walk of the dominator tree, a stack of names per local
  const names: Record<string, SsaDef> = {},
    uses: Record<string, string> = {},
    defs: Record<string, string> = {};
  const counter = f.locals.map(() => 0),
    stacks: string[][] = f.locals.map(() => []);
  // a local whose name another local shares (Candela has such functions, from nested scopes) is named with its
  // index too: `z#4.1`; neither `.` nor `#` can occur in a Typed identifier, so names stay unique
  const shared = new Set(f.locals.map(l => l.name).filter((n, i, all) => all.indexOf(n) !== i));
  const base = f.locals.map((l, i) => (shared.has(l.name) ? `${l.name}#${i}` : l.name));
  const fresh = (l: number) => `${base[l]}.${counter[l]++}`;
  const top = (l: number) => stacks[l][stacks[l].length - 1];
  f.locals.forEach((loc, i) => {
    const name = fresh(i);
    names[name] = {
      local: i,
      kind: loc.param ? 'param' : 'init',
      block: VIRTUAL_ENTRY,
      def: (loc.param ? 'param:' : 'init:') + i,
    };
    stacks[i].push(name);
  });
  for (const phi of phiRecs.get(entry) ?? []) phi.args[VIRTUAL_ENTRY] = top(phi.local);
  const children = new Map<string, string[]>(rpo.map(b => [b, []]));
  for (const b of rpo) if (b !== entry) children.get(idom.get(b)!)!.push(b);
  const readGets = (vid: string | undefined) => {
    const work = vid ? [vid] : [];
    while (work.length) {
      const v = st.get(work.pop()!) as ValueRec;
      if (v.op === 'get') uses[v.id] = top(v.imm as number);
      for (const a of v.args) work.push(a);
    }
  };
  const frames: { block: string; exit: boolean; pushed?: number[] }[] = [{ block: entry, exit: false }];
  while (frames.length) {
    const fr = frames.pop()!;
    if (fr.exit) {
      for (const l of fr.pushed!) stacks[l].pop();
      continue;
    }
    const b = fr.block,
      pushed: number[] = [];
    for (const phi of phiRecs.get(b) ?? []) {
      phi.name = fresh(phi.local);
      names[phi.name] = { local: phi.local, kind: 'phi', block: b };
      stacks[phi.local].push(phi.name);
      pushed.push(phi.local);
    }
    for (const sid of (st.get(b) as BlockRec).stmts) {
      const s = st.get(sid) as StmtRec;
      for (const vid of stmtValues(s)) readGets(vid);
      if (s.op === 'set') {
        const name = fresh(s.local!);
        names[name] = { local: s.local!, kind: 'set', block: b, stmt: sid, value: s.value!, def: sid };
        defs[sid] = name;
        stacks[s.local!].push(name);
        pushed.push(s.local!);
      }
    }
    for (const s of succs(b)) for (const phi of phiRecs.get(s) ?? []) phi.args[b] = top(phi.local);
    frames.push({ block: b, exit: true, pushed });
    const kids = children.get(b)!;
    for (let i = kids.length - 1; i >= 0; i--) frames.push({ block: kids[i], exit: false });
  }

  const byRpo = (s: Set<string>) =>
    [...s].filter(x => x !== VIRTUAL_ENTRY).sort((a, b) => position.get(a)! - position.get(b)!);
  return {
    entry,
    names,
    phis: Object.fromEntries(
      [...phiRecs].map(([b, ps]) => [b, ps.map(p => ({ ...p, args: { ...p.args } }))]),
    ),
    uses,
    defs,
    idom: Object.fromEntries(idom),
    frontier: Object.fromEntries([...df].filter(([b]) => b !== VIRTUAL_ENTRY).map(([b, s]) => [b, byRpo(s)])),
    unreachable: f.blocks.map(b => b.id).filter(b => !reachable.has(b)),
  };
}

const SsaFacts = defineType<Readonly<Record<string, SsaFn>>>({
  id: 'typed.ssa-facts',
  version: '1',
  description: 'per-function SSA form as finite JSON',
  validate(v) {
    canonical(v);
    if (!v || typeof v !== 'object') throw new Error('SSA facts must be an object keyed by function');
  },
});

/**
 * The SSA view as an analysis: a new name, cached per revision like every fact. It is not in ANALYSES (whose six
 * names a test and the workbench list); passes that use SSA compute `ssaOf` on their working copy, as the views do.
 */
export const ssaAnalysis = defineAnalysis({
  id: 'typed.ssa',
  version: '1',
  description: 'static single assignment: phis at iterated dominance frontiers, names by renaming',
  input: BlocksIR,
  output: SsaFacts,
  run: (_ctx, a) => {
    const st = storeOf((a as { value: TypedBlocks }).value);
    return Object.fromEntries([...st.fns.values()].map(f => [f.name, ssaOf(st, f)]));
  },
});

// ---------- queries ----------
export interface SsaView {
  readonly fact: SsaFn;
  /** The definition a `get` value reads. */
  defOf(get: string): SsaDef | undefined;
  /** The reads of a name: `get` values, and phis that take it as an argument. */
  usersOf(name: string): { gets: string[]; phis: { block: string; name: string; pred: string }[] };
  phisOf(block: string): readonly SsaPhi[];
  /** The reaching-definition ids a name stands for: itself, or through phis the definitions of their arguments. */
  reachingDefs(name: string): string[];
  dominates(a: string, b: string): boolean;
}
export function ssaView(fact: SsaFn): SsaView {
  const gets = new Map<string, string[]>(),
    phiUsers = new Map<string, { block: string; name: string; pred: string }[]>();
  for (const [g, n] of Object.entries(fact.uses)) (gets.get(n) ?? gets.set(n, []).get(n)!).push(g);
  for (const [block, ps] of Object.entries(fact.phis))
    for (const p of ps)
      for (const [pred, a] of Object.entries(p.args))
        (phiUsers.get(a) ?? phiUsers.set(a, []).get(a)!).push({ block, name: p.name, pred });
  const phiOf = new Map<string, SsaPhi>();
  for (const ps of Object.values(fact.phis)) for (const p of ps) phiOf.set(p.name, p);
  const memo = new Map<string, string[]>();
  const reachingDefs = (name: string): string[] => {
    const hit = memo.get(name);
    if (hit) return hit;
    const out = new Set<string>(),
      seen = new Set<string>([name]),
      work = [name];
    while (work.length) {
      const n = work.pop()!,
        d = fact.names[n];
      if (d.kind !== 'phi') {
        out.add(d.def!);
        continue;
      }
      for (const a of Object.values(phiOf.get(n)!.args))
        if (!seen.has(a)) {
          seen.add(a);
          work.push(a);
        }
    }
    const r = [...out].sort();
    memo.set(name, r);
    return r;
  };
  const dominates = (a: string, b: string): boolean => {
    for (let x: string | undefined = b; x; x = x === VIRTUAL_ENTRY ? undefined : fact.idom[x])
      if (x === a) return true;
    return false;
  };
  return {
    fact,
    defOf: g => (fact.uses[g] ? fact.names[fact.uses[g]] : undefined),
    usersOf: n => ({ gets: gets.get(n) ?? [], phis: phiUsers.get(n) ?? [] }),
    phisOf: b => fact.phis[b] ?? [],
    reachingDefs,
    dominates,
  };
}

/** Phis whose local is not live on entry to their block (minimal SSA places them; pruned SSA would not). */
export function deadPhis(fact: SsaFn, live: LiveView): number {
  let n = 0;
  for (const [b, ps] of Object.entries(fact.phis)) for (const p of ps) if (!live.liveIn(b).has(p.local)) n++;
  return n;
}

// ---------- validation against reaching definitions ----------
export interface SsaCheck {
  readonly fn: string;
  readonly blocks: number;
  readonly gets: number;
  /** (definition, use) pairs of reaching definitions, i.e. the def-use chains compared. */
  readonly pairs: number;
  readonly names: number;
  readonly phis: number;
  readonly unreachable: number;
  readonly mismatches: readonly {
    stmt: string;
    get: string;
    local: number;
    reaching: string[];
    ssa: string[];
  }[];
  readonly violations: readonly string[];
}

/**
 * Check an SSA form against reaching definitions: for every `get` g of local l in a reachable statement s, the
 * definitions its name stands for (through phis) are exactly `reach.reachingAt(s, l)`. Also check the SSA
 * invariants: one definition per name, one phi argument per reachable predecessor, and every definition dominating
 * its uses (a phi argument: the end of its predecessor).
 */
export function checkSsa(st: Store, f: WorkFn, fact: SsaFn, reach: ReachView): SsaCheck {
  const view = ssaView(fact),
    mismatches: SsaCheck['mismatches'][number][] = [],
    violations: string[] = [];
  const unreachable = new Set(fact.unreachable);
  const cfg = cfgOf(f);
  let gets = 0,
    pairs = 0;
  for (const b of f.blocks) {
    if (unreachable.has(b.id)) continue;
    b.stmts.forEach((sid, index) => {
      const s = st.get(sid) as StmtRec;
      const work = stmtValues(s);
      while (work.length) {
        const v = st.get(work.pop()!) as ValueRec;
        work.push(...v.args);
        if (v.op !== 'get') continue;
        gets++;
        const l = v.imm as number,
          expect = [...new Set(reach.reachingAt(sid, l))].sort();
        pairs += expect.length;
        const name = fact.uses[v.id];
        if (!name) {
          violations.push(`${v.id} in ${sid} has no SSA name`);
          continue;
        }
        const got = view.reachingDefs(name);
        if (got.join() !== expect.join())
          mismatches.push({ stmt: sid, get: v.id, local: l, reaching: expect, ssa: got });
        const d = fact.names[name];
        if (d.local !== l)
          violations.push(`${v.id} reads local ${l} but its name ${name} is of local ${d.local}`);
        if (!view.dominates(d.block, b.id))
          violations.push(`${name} (${d.block}) does not dominate its use in ${b.id}`);
        if (d.kind === 'set' && d.block === b.id && b.stmts.indexOf(d.stmt!) >= index)
          violations.push(`${name} is used in ${sid} before (or by) its own definition`);
      }
    });
  }
  const defined = Object.keys(fact.names).length;
  if (new Set(Object.keys(fact.names)).size !== defined) violations.push('a name is defined twice');
  let phis = 0;
  for (const [y, ps] of Object.entries(fact.phis)) {
    const expect = [
      ...(y === fact.entry ? [VIRTUAL_ENTRY] : []),
      ...new Set((cfg.preds[y] ?? []).filter(p => !unreachable.has(p))),
    ].sort();
    for (const p of ps) {
      phis++;
      if (Object.keys(p.args).sort().join() !== expect.join())
        violations.push(
          `phi ${p.name} at ${y} has arguments for [${Object.keys(p.args)}], preds [${expect}]`,
        );
      for (const [pred, a] of Object.entries(p.args))
        if (pred !== VIRTUAL_ENTRY && !view.dominates(fact.names[a].block, pred))
          violations.push(`phi argument ${a} of ${p.name} does not dominate the end of ${pred}`);
    }
  }
  return {
    fn: f.name,
    blocks: f.blocks.length,
    gets,
    pairs,
    names: defined,
    phis,
    unreachable: unreachable.size,
    mismatches,
    violations,
  };
}
