/**
 * Sparse conditional constant propagation over the SSA view (IRWB-006: the first consumer of A1, a first piece of
 * agenda item A2). Wegman and Zadeck's algorithm: one lattice value per SSA name (⊤: not yet seen to execute, a
 * constant, ⊥: varies) and one flag per control-flow edge (executable or not), propagated together, so a branch on
 * a constant makes the other edge dead, which can make a phi constant, which can decide another branch, in one run.
 *
 * The lattice is the standard library's flat one (`stdlib/lattice/lattices.ts`, IRWB-048-B): three levels, which is
 * this algorithm's lattice — the library's bottom ("no value yet", W-Z's ⊤) below any single constant below the
 * library's top ("varies", W-Z's ⊥), constants compared as JSON, so the same bits and type are the same constant.
 * The client keeps W-Z's names locally in the comments only: this module reads the library's `BOT` where the paper
 * starts a name at ⊤ and the library's `TOP` where it ends at ⊥.
 *
 * The pass `sccp` then replaces, like `constprop`, every `get` in an executable block whose name is a constant by
 * that constant (of the local's type). Folding the now-constant conditions and removing dead arms is left to `fold`
 * and `cfg`. Operators are evaluated as `fold` evaluates them (`evalOp`: binop, f32Op; a trapping division, and the
 * operators fold leaves to run time, are ⊥), so every constant is one `fold` could have produced.
 *
 * The pass is not in PASSES and its pipeline not in PIPELINES (O2 and the registries stay as they are); it runs
 * through `Program.apply(pass)` with `runPasses`.
 */
import { cfgOf } from './analyses.js';
import { BOT, TOP, flatLattice, type Flat } from '../stdlib/lattice/lattices.js';
import { F32_FOLDABLE, F32_RESULT } from './f32.js';
import { typeClass, type StmtRec, type Store, type ValueRec, type WorkFn } from './model.js';
import { PASSES, PIPELINES, typedPass, type TypedPass } from './passes.js';
import { evalOp } from './rules/compile.js';
import { FOLD_I32 } from './rules/fold.js';
import { ssaOf, VIRTUAL_ENTRY, type SsaFn } from './ssa.js';

/** A constant's bits and the type it is read as; f32 values are carried as IEEE bit patterns, so both are integers. */
export type Const = { readonly v: number; readonly t: 'i32' | 'f32' };
export type Lat = Flat<Const>;
const flat = flatLattice<Const>();
const constant = (v: number, t: 'i32' | 'f32'): Lat => ({ value: { v, t } });
/** The constant inside a lattice value, or undefined when the value is bottom or top. */
const constantOf = (a: Lat): Const | undefined => (typeof a === 'object' ? a.value : undefined);
/** The lattice's join, named as SCCP names it: the meet of the values arriving at a phi. */
export const meet = (a: Lat, b: Lat): Lat => flat.join(a, b);

const FOLDS = new Set<string>(['eqz', ...FOLD_I32, ...F32_FOLDABLE]);
const MIN = -2147483648;

export interface SccpResult {
  /** SSA name -> lattice value. */
  readonly values: ReadonlyMap<string, Lat>;
  /** Executable edges as `pred>block` ('^entry>entry' included). */
  readonly edges: ReadonlySet<string>;
  readonly blocks: ReadonlySet<string>;
  readonly rounds: number;
}

/** The SCCP fixpoint of one function, on its SSA form. */
export function sccpOf(st: Store, f: WorkFn, ssa: SsaFn): SccpResult {
  const L = new Map<string, Lat>();
  // A parameter varies (nothing above this function is known); every other name starts unknown, i.e. not yet seen to
  // execute, which is the lattice's bottom.
  for (const [n, d] of Object.entries(ssa.names))
    L.set(
      n,
      d.kind === 'param' ? TOP : d.kind === 'init' ? constant(0, typeClass(f.locals[d.local].type)) : BOT,
    );
  const edges = new Set<string>([`${VIRTUAL_ENTRY}>${ssa.entry}`]),
    blocks = new Set<string>([ssa.entry]);
  const rpo = cfgOf(f).rpo.filter(b => !ssa.unreachable.includes(b));
  const evalTree = (vid: string): Lat => {
    const v = st.get(vid) as ValueRec;
    if (v.op === 'const') return constant(v.imm as number, v.type === 'f32' ? 'f32' : 'i32');
    if (v.op === 'get') return L.get(ssa.uses[vid]) ?? BOT;
    if (!FOLDS.has(v.op)) return TOP;
    const args = v.args.map(evalTree);
    if (args.some(a => a === TOP)) return TOP;
    if (args.some(a => a === BOT)) return BOT;
    const xs = args.map(a => constantOf(a)!.v);
    if ((v.op === 'div' || v.op === 'rem') && (xs[1] === 0 || (xs[0] === MIN && xs[1] === -1))) return TOP;
    return constant(evalOp(v.op, xs) | 0, F32_RESULT.has(v.op) ? 'f32' : 'i32');
  };
  let changed = true,
    rounds = 0;
  const set = (name: string, val: Lat) => {
    if (!flat.equal(L.get(name)!, val)) {
      L.set(name, val);
      changed = true;
    }
  };
  const mark = (from: string, to: string) => {
    const e = `${from}>${to}`;
    if (edges.has(e)) return;
    edges.add(e);
    blocks.add(to);
    changed = true;
  };
  while (changed) {
    changed = false;
    rounds++;
    for (const b of rpo) {
      if (!blocks.has(b)) continue;
      for (const phi of ssa.phis[b] ?? []) {
        let val: Lat = BOT;
        for (const [pred, a] of Object.entries(phi.args))
          if (edges.has(`${pred}>${b}`)) val = meet(val, L.get(a)!);
        set(phi.name, val);
      }
      for (const sid of (st.get(b) as { stmts: string[] }).stmts) {
        const s = st.get(sid) as StmtRec;
        if (s.op === 'set') set(ssa.defs[sid], evalTree(s.value!));
        else if (s.op === 'br') mark(b, s.to!);
        else if (s.op === 'br_if') {
          const c = evalTree(s.cond!),
            k = constantOf(c);
          // A constant condition marks the arm it takes; a varying one (the top) both arms; an unknown one neither,
          // because until its name is a value the branch is not yet seen to execute.
          if (k) mark(b, k.v !== 0 ? s.then! : s.else!);
          else if (c === TOP) {
            mark(b, s.then!);
            mark(b, s.else!);
          }
        }
      }
    }
  }
  return { values: L, edges, blocks, rounds };
}

/** The `set` statements (and initial values) a constant name rests on, through phi arguments on executable edges. */
function contributing(ssa: SsaFn, res: SccpResult, name: string, f: WorkFn): string[] {
  const out = new Set<string>(),
    seen = new Set([name]),
    work = [name];
  const phiOf = new Map(
    Object.values(ssa.phis).flatMap(ps => ps.map(p => [p.name, { p, block: '' }] as const)),
  );
  const blockOf = new Map(Object.entries(ssa.phis).flatMap(([b, ps]) => ps.map(p => [p.name, b] as const)));
  while (work.length) {
    const n = work.pop()!,
      d = ssa.names[n];
    if (d.kind === 'set') out.add(d.stmt!);
    else if (d.kind === 'init') out.add(`local:${f.name}/${f.locals[d.local].name} starts at 0`);
    else if (d.kind === 'phi')
      for (const [pred, a] of Object.entries(phiOf.get(n)!.p.args))
        if (res.edges.has(`${pred}>${blockOf.get(n)}`) && !seen.has(a)) {
          seen.add(a);
          work.push(a);
        }
  }
  return [...out].sort();
}

export const sccp: TypedPass = typedPass({
  name: 'sccp',
  about:
    'sparse conditional constant propagation: a read whose SSA name is constant on the executable edges becomes that constant',
  writes: ['values'],
  preserves: ['cfg', 'dominators', 'loops'],
  body({ st, f, tx }) {
    const ssa = ssaOf(st, f),
      res = sccpOf(st, f, ssa);
    for (const b of f.blocks) {
      if (!res.blocks.has(b.id)) continue;
      tx.rewrite(
        v => {
          if (v.op !== 'get') return;
          const name = ssa.uses[v.id],
            lat = name ? res.values.get(name) : undefined,
            c = lat && constantOf(lat);
          if (!c) return;
          return tx.const(c.v, {
            because: [`fact:sccp(${f.name})@r${tx.rev - 1}`, ...contributing(ssa, res, name, f)],
            type: typeClass(f.locals[v.imm as number].type),
          });
        },
        [b],
      );
    }
  },
});

/** Passes this module adds, by name, and their pipelines (outside PASSES and PIPELINES). */
export const SSA_PASSES: Readonly<Record<string, TypedPass>> = Object.freeze({ sccp });
export const SSA_PIPELINES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  /** O2 with each constprop replaced by sccp. */
  'O2-sccp': PIPELINES.O2.map(n => (n === 'constprop' ? 'sccp' : n)),
});
export const passNamed = (name: string): TypedPass => {
  const p = SSA_PASSES[name] ?? PASSES[name];
  if (!p) throw new Error(`unknownPass: no pass named "${name}"`);
  return p;
};

/**
 * Run a list of pass names (or a pipeline of SSA_PIPELINES or PIPELINES) on a program host, one revision per pass
 * that changes it, each under the host's meaning contract; a rejected pass is recorded and skipped, as
 * `Program.pipeline` does.
 */
export async function runPasses(
  program: { apply(pass: TypedPass): Promise<unknown> },
  names: string | readonly string[],
): Promise<{ pass: string; rejected?: string }[]> {
  const list = typeof names === 'string' ? (SSA_PIPELINES[names] ?? PIPELINES[names]) : names;
  if (!list) throw new Error(`unknownPipeline: no pipeline "${names}"`);
  const steps: { pass: string; rejected?: string }[] = [];
  for (const n of list)
    try {
      await program.apply(passNamed(n));
      steps.push({ pass: n });
    } catch (e) {
      if ((e as { code?: string }).code !== 'contractRejected') throw e;
      steps.push({ pass: n, rejected: (e as Error).message.slice(0, 300) });
    }
  return steps;
}
