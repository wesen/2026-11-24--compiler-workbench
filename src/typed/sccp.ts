/**
 * Sparse conditional constant propagation over the SSA view (IRWB-006: the first consumer of A1, a first piece of
 * agenda item A2). Wegman and Zadeck's algorithm: one lattice value per SSA name (⊤: not yet seen to execute, a
 * constant, ⊥: varies) and one flag per control-flow edge (executable or not), propagated together, so a branch on
 * a constant makes the other edge dead, which can make a phi constant, which can decide another branch, in one run.
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
import { F32_FOLDABLE, F32_RESULT } from './f32.js';
import { typeClass, type StmtRec, type Store, type ValueRec, type WorkFn } from './model.js';
import { PASSES, PIPELINES, typedPass, type TypedPass } from './passes.js';
import { evalOp } from './rules/compile.js';
import { FOLD_I32 } from './rules/fold.js';
import { ssaOf, VIRTUAL_ENTRY, type SsaFn } from './ssa.js';

export type Lat =
  | { readonly k: 'top' }
  | { readonly k: 'const'; readonly v: number; readonly t: 'i32' | 'f32' }
  | { readonly k: 'bot' };
const TOP: Lat = { k: 'top' },
  BOT: Lat = { k: 'bot' };
const same = (a: Lat, b: Lat) =>
  a.k === b.k && (a.k !== 'const' || (b.k === 'const' && a.v === b.v && a.t === b.t));
export const meet = (a: Lat, b: Lat): Lat =>
  a.k === 'top' ? b : b.k === 'top' ? a : a.k === 'const' && same(a, b) ? a : BOT;

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
  for (const [n, d] of Object.entries(ssa.names))
    L.set(
      n,
      d.kind === 'param'
        ? BOT
        : d.kind === 'init'
          ? { k: 'const', v: 0, t: typeClass(f.locals[d.local].type) }
          : TOP,
    );
  const edges = new Set<string>([`${VIRTUAL_ENTRY}>${ssa.entry}`]),
    blocks = new Set<string>([ssa.entry]);
  const rpo = cfgOf(f).rpo.filter(b => !ssa.unreachable.includes(b));
  const evalTree = (vid: string): Lat => {
    const v = st.get(vid) as ValueRec;
    if (v.op === 'const') return { k: 'const', v: v.imm as number, t: v.type === 'f32' ? 'f32' : 'i32' };
    if (v.op === 'get') return L.get(ssa.uses[vid]) ?? BOT;
    if (!FOLDS.has(v.op)) return BOT;
    const args = v.args.map(evalTree);
    if (args.some(a => a.k === 'bot')) return BOT;
    if (args.some(a => a.k === 'top')) return TOP;
    const xs = args.map(a => (a as { v: number }).v);
    if ((v.op === 'div' || v.op === 'rem') && (xs[1] === 0 || (xs[0] === MIN && xs[1] === -1))) return BOT;
    return { k: 'const', v: evalOp(v.op, xs) | 0, t: F32_RESULT.has(v.op) ? 'f32' : 'i32' };
  };
  let changed = true,
    rounds = 0;
  const set = (name: string, val: Lat) => {
    if (!same(L.get(name)!, val)) {
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
        let val: Lat = TOP;
        for (const [pred, a] of Object.entries(phi.args))
          if (edges.has(`${pred}>${b}`)) val = meet(val, L.get(a)!);
        set(phi.name, val);
      }
      for (const sid of (st.get(b) as { stmts: string[] }).stmts) {
        const s = st.get(sid) as StmtRec;
        if (s.op === 'set') set(ssa.defs[sid], evalTree(s.value!));
        else if (s.op === 'br') mark(b, s.to!);
        else if (s.op === 'br_if') {
          const c = evalTree(s.cond!);
          if (c.k === 'const') mark(b, c.v !== 0 ? s.then! : s.else!);
          else if (c.k === 'bot') {
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
            lat = name ? res.values.get(name) : undefined;
          if (!lat || lat.k !== 'const') return;
          return tx.const(lat.v, {
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
