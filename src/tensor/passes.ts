/**
 * IRWB-020-N: the two checked tensor passes and their deliberately wrong variants (design §7).
 *
 *   - `inline` (exact contract): a pointwise statement with exactly one use is substituted into that use;
 *   - `split-sum` (tolerance contract): a one-axis `sum` becomes blocks of 4, then the sum within each block,
 *     with a guard so it works for symbolic extents;
 *   - `inline-wrong` also reassociates `x * (y * z)` and `x + (y + z)` in the copy (exact over the reals, so only
 *     the exact relation can reject it); `split-sum-wrong` takes floor(E/4) blocks, dropping the remainder.
 *
 * Every pass returns a native module and its correspondence; the framework diffs, enforces `writes` and checks
 * the contract (`applyPassSync` from `optimizeTix`, or `applyPass` with a manager).
 */
import { definePass, type Pass } from '../framework/passes/define-pass.js';
import type { CorrespondenceEntry } from '../framework/ir/types.js';
import type { Artifact } from '../framework/core/types.js';
import { A, children, TixIR, tixAdapter, type Affine, type Expr, type TixModule } from './ir.js';
import { exactContract, toleranceContract } from './contract.js';

type Mut = { -readonly [K in keyof TixModule]: any } & {
  exprs: Record<string, any>;
  stmts: Record<string, any>;
  fns: Record<string, any>;
};
const clone = (a: Artifact<TixModule>): Mut => JSON.parse(JSON.stringify(a.value));
const freshId = (m: Mut) => `e${m.next++}`;

function treeIds(m: Mut, root: string): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    for (const c of children(m.exprs[id] as Expr)) walk(c);
  };
  walk(root);
  return out;
}

// ---------- inline ----------

/** Copy the tree at `eid` with indices substituted; the copy's root takes the id `into`. Records old -> new ids. */
function copyTree(
  m: Mut,
  eid: string,
  sub: Record<string, Affine>,
  into: string,
  map: Map<string, string>,
): void {
  const e = m.exprs[eid];
  const node: any = { ...e };
  if (e.op === 'ref') node.at = e.at.map((a: Affine) => A.subst(a, sub));
  for (const k of ['a', 'b', 'body'] as const)
    if (k in e) {
      const id = freshId(m);
      copyTree(m, e[k], sub, id, map);
      node[k] = id;
    }
  m.exprs[into] = node;
  map.set(eid, into);
}

/** In-place reassociation of `x op (y op z)` into `(x op y) op z` for op in {mul, add}, top-down (the bug). */
function reassociate(m: Mut, id: string): void {
  const e = m.exprs[id];
  if ((e.op === 'mul' || e.op === 'add') && m.exprs[e.b].op === e.op) {
    const yz = e.b,
      inner = m.exprs[yz];
    m.exprs[yz] = { op: e.op, a: e.a, b: inner.a };
    m.exprs[id] = { op: e.op, a: yz, b: inner.b };
  }
  for (const c of children(m.exprs[id])) reassociate(m, c);
}

/**
 * One inlining step. `origin` maps a current expression id to the input expressions it came from, so a chain of
 * inlinings (P into Q, then Q into R) still yields correspondence from the input's ids to the output's.
 */
function inlineOnce(m: Mut, wrong: boolean, origin: Map<string, Set<string>>): boolean {
  for (const fname of Object.keys(m.fns).sort()) {
    const f = m.fns[fname];
    for (const sid of f.body as string[]) {
      if (sid === f.returns) continue;
      const st = m.stmts[sid];
      const own = treeIds(m, st.root);
      if (own.some(id => m.exprs[id].op === 'reduce')) continue;
      const uses: string[] = [];
      for (const other of f.body as string[])
        if (other !== sid)
          for (const id of treeIds(m, m.stmts[other].root)) {
            const e = m.exprs[id];
            if (e.op === 'ref' && e.kind === 'stmt' && e.name === sid) uses.push(id);
          }
      if (uses.length !== 1) continue;
      const use = uses[0];
      const ref = m.exprs[use];
      const sub: Record<string, Affine> = Object.fromEntries(
        st.indices.map((ix: any, k: number) => [ix.name, ref.at[k]]),
      );
      const map = new Map<string, string>();
      copyTree(m, st.root, sub, use, map);
      if (wrong) reassociate(m, use);
      for (const id of own) delete m.exprs[id];
      delete m.stmts[sid];
      f.body = (f.body as string[]).filter(x => x !== sid);
      const of = (id: string) => origin.get(id) ?? new Set([id]);
      const merged = new Set([...of(use), ...of(st.root)]);
      for (const [from, to] of map) if (from !== st.root) origin.set(to, of(from));
      origin.set(use, merged);
      for (const id of own) origin.delete(id);
      return true;
    }
  }
  return false;
}

function makeInline(wrong: boolean): Pass<TixModule> {
  return definePass<TixModule>({
    id: wrong ? 'tensor.inline-wrong' : 'tensor.inline',
    version: '1',
    description: wrong
      ? 'inline, then reassociate products and sums in the copy (deliberately wrong under the exact relation)'
      : 'substitute a pointwise statement with exactly one use into that use',
    ir: TixIR,
    adapter: tixAdapter,
    writes: { entities: ['stmt', 'expr.*'], relations: ['contains', 'root', 'operand', 'reads'] },
    contract: exactContract,
    run: ({ before }) => {
      const m = clone(before);
      const origin = new Map<string, Set<string>>();
      let n = 0;
      while (inlineOnce(m, wrong, origin)) n++;
      if (!n) return;
      const correspondence: CorrespondenceEntry[] = [];
      for (const [to, from] of origin) {
        const src = [...from].filter(id => id in before.value.exprs).sort();
        if (src.length && !(src.length === 1 && src[0] === to))
          correspondence.push({ from: src.map(id => `expr:${id}`), to: [`expr:${to}`], relation: 'inlined' });
      }
      return { native: m as TixModule, correspondence, edits: n };
    },
  });
}

// ---------- split-sum ----------

export const BLOCK = 4;

function namesOf(m: Mut, fname: string): Set<string> {
  const f = m.fns[fname];
  const out = new Set<string>([...f.shapes, ...f.params.map((p: any) => p.name)]);
  for (const sid of f.body) {
    const st = m.stmts[sid];
    out.add(st.tensor);
    for (const ix of st.indices) out.add(ix.name);
    for (const id of treeIds(m, st.root)) {
      const e = m.exprs[id];
      if (e.op === 'reduce') for (const ax of e.axes) out.add(ax.name);
    }
  }
  return out;
}
function fresh(taken: Set<string>, base: string): string {
  let n = base;
  for (let k = 2; taken.has(n); k++) n = `${base}${k}`;
  taken.add(n);
  return n;
}

function makeSplit(wrong: boolean): Pass<TixModule> {
  return definePass<TixModule>({
    id: wrong ? 'tensor.split-sum-wrong' : 'tensor.split-sum',
    version: '1',
    description: wrong
      ? 'split-sum with floor(E/4) blocks (deliberately wrong: drops the remainder)'
      : `rewrite a one-axis sum into a sum over blocks of ${BLOCK} of the sums within the blocks`,
    ir: TixIR,
    adapter: tixAdapter,
    writes: { entities: ['expr.*'], relations: ['operand', 'root'] },
    contract: toleranceContract,
    run: ({ before }) => {
      const m = clone(before);
      const corr: CorrespondenceEntry[] = [];
      for (const fname of Object.keys(m.fns).sort()) {
        const taken = namesOf(m, fname);
        for (const sid of m.fns[fname].body as string[]) {
          const targets = treeIds(m, m.stmts[sid].root).filter(id => {
            const e = m.exprs[id];
            return e.op === 'reduce' && e.kind === 'sum' && e.axes.length === 1 && !e.guard && !e.blocked;
          });
          for (const id of targets) {
            const e = m.exprs[id];
            const j: string = e.axes[0].name,
              E: Affine = e.axes[0].extent.aff;
            const jb = fresh(taken, `${j}_b`),
              jk = fresh(taken, `${j}_k`);
            const flat = A.add(A.scale(A.name(jb), BLOCK), A.name(jk));
            for (const x of treeIds(m, e.body)) {
              const r = m.exprs[x];
              if (r.op === 'ref') r.at = r.at.map((a: Affine) => A.subst(a, { [j]: flat }));
            }
            const inner = freshId(m);
            m.exprs[inner] = {
              op: 'reduce',
              kind: 'sum',
              axes: [{ name: jk, extent: { aff: A.num(BLOCK) } }],
              guard: [{ at: flat, lt: E }],
              blocked: true,
              body: e.body,
            };
            m.exprs[id] = {
              op: 'reduce',
              kind: 'sum',
              axes: [{ name: jb, extent: { aff: wrong ? A.sub(E, A.num(BLOCK - 1)) : E, div: BLOCK } }],
              blocked: true,
              body: inner,
            };
            corr.push({ from: [`expr:${id}`], to: [`expr:${id}`, `expr:${inner}`], relation: 'split' });
          }
        }
      }
      if (!corr.length) return;
      return { native: m as TixModule, correspondence: corr, edits: corr.length };
    },
  });
}

export const inline = makeInline(false);
export const splitSum = makeSplit(false);
/** Test-only deliberately wrong variants; not reachable through `optimizeTix`. */
export const inlineWrong = makeInline(true);
export const splitSumWrong = makeSplit(true);

/** The passes `optimizeTix` names. */
export const PASSES: Readonly<Record<string, Pass<TixModule>>> = { inline, 'split-sum': splitSum };
