/**
 * Static block frequencies and the backend's cost estimate (IRWB-003). There is no profile: how often a block
 * runs per call is estimated from the control flow alone, with the loop-branch heuristics of static branch
 * prediction (Ball and Larus), so that the layout can make hot edges fall through and the coalescing and
 * constant-home options can compare two compilations of one function.
 *
 *   prob(b -> s)   a check that fails (a block ending in trap) is taken with 0; an edge that stays in b's cycle
 *                  0.88 against 0.12 for one that leaves it; an edge that enters a cycle 0.88; otherwise 0.5
 *   freq(b)        [b = entry] + Σ_p freq(p) · prob(p -> b), solved by sweeps in reverse postorder
 *   cost(code)     Σ over finished instructions of the frequency of the IR block they belong to
 *
 * Cycles are strongly connected components, not natural loops, because a rotated loop can be irreducible.
 */
import type { BlockRec, StmtRec, Store, WorkFn } from '../model.js';
import type { MInsn } from './encode.js';

export interface Edge {
  readonly from: string;
  readonly to: string;
  readonly prob: number;
}

export interface Frequencies {
  /** Estimated executions per call of each block. */
  readonly block: ReadonlyMap<string, number>;
  /** Every edge of every block's terminator (or its fall-through), with its probability. */
  readonly edges: readonly Edge[];
}

const STAY = 0.88,
  LEAVE = 0.12;

const lastOf = (st: Store, b: BlockRec): StmtRec | undefined =>
  b.stmts.length ? (st.get(b.stmts.at(-1)!) as StmtRec) : undefined;

/** The successors of b by its terminator; a block without one falls through to succ[0]. */
export function targetsOf(st: Store, b: BlockRec): string[] {
  const last = lastOf(st, b);
  if (!last) return b.succ.slice(0, 1);
  switch (last.op) {
    case 'br':
      return [last.to!];
    case 'br_if':
      return last.then === last.else ? [last.then!] : [last.then!, last.else!];
    case 'return':
    case 'trap':
      return [];
    default:
      return b.succ.slice(0, 1);
  }
}

/** Strongly connected components (Tarjan, iterative); returns each block's component and which ones are cycles. */
function components(blocks: readonly string[], succ: (b: string) => readonly string[]) {
  const index = new Map<string, number>(),
    low = new Map<string, number>(),
    comp = new Map<string, number>(),
    onStack = new Set<string>(),
    stack: string[] = [];
  const cyclic: boolean[] = [];
  let n = 0;
  for (const root of blocks) {
    if (index.has(root)) continue;
    const work: { b: string; i: number }[] = [{ b: root, i: 0 }];
    index.set(root, n);
    low.set(root, n++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const top = work[work.length - 1];
      const ss = succ(top.b);
      if (top.i < ss.length) {
        const s = ss[top.i++];
        if (!index.has(s)) {
          index.set(s, n);
          low.set(s, n++);
          stack.push(s);
          onStack.add(s);
          work.push({ b: s, i: 0 });
        } else if (onStack.has(s)) low.set(top.b, Math.min(low.get(top.b)!, index.get(s)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].b;
        low.set(parent, Math.min(low.get(parent)!, low.get(top.b)!));
      }
      if (low.get(top.b) === index.get(top.b)) {
        const id = cyclic.length,
          members: string[] = [];
        for (;;) {
          const x = stack.pop()!;
          onStack.delete(x);
          comp.set(x, id);
          members.push(x);
          if (x === top.b) break;
        }
        cyclic.push(members.length > 1 || succ(top.b).includes(top.b));
      }
    }
  }
  return { comp, cyclic };
}

export function blockFrequencies(st: Store, f: WorkFn): Frequencies {
  const ids = f.blocks.map(b => b.id);
  const known = new Set(ids);
  const succ = new Map(f.blocks.map(b => [b.id, targetsOf(st, b).filter(s => known.has(s))]));
  const trapping = new Set(f.blocks.filter(b => lastOf(st, b)?.op === 'trap').map(b => b.id));
  const { comp, cyclic } = components(ids, b => succ.get(b) ?? []);
  const inCycle = (b: string) => cyclic[comp.get(b)!];
  const edges: Edge[] = [];
  for (const b of ids) {
    const ts = succ.get(b)!;
    if (ts.length === 1) edges.push({ from: b, to: ts[0], prob: 1 });
    if (ts.length !== 2) continue;
    const [T, E] = ts;
    let pT = 0.5;
    if (trapping.has(T) !== trapping.has(E)) pT = trapping.has(T) ? 0 : 1;
    else {
      const stayT = inCycle(b) && comp.get(T) === comp.get(b),
        stayE = inCycle(b) && comp.get(E) === comp.get(b);
      const enterT = inCycle(T) && comp.get(T) !== comp.get(b),
        enterE = inCycle(E) && comp.get(E) !== comp.get(b);
      if (stayT !== stayE) pT = stayT ? STAY : LEAVE;
      else if (!stayT && enterT !== enterE) pT = enterT ? STAY : LEAVE;
    }
    edges.push({ from: b, to: T, prob: pT }, { from: b, to: E, prob: 1 - pT });
  }
  // reverse postorder from the entry, then the unreachable blocks (which keep 0)
  const seen = new Set<string>(),
    post: string[] = [];
  const dfs = (root: string) => {
    const work: { b: string; i: number }[] = [{ b: root, i: 0 }];
    seen.add(root);
    while (work.length) {
      const top = work[work.length - 1],
        ss = succ.get(top.b)!;
      if (top.i < ss.length) {
        const s = ss[top.i++];
        if (!seen.has(s)) {
          seen.add(s);
          work.push({ b: s, i: 0 });
        }
      } else {
        post.push(top.b);
        work.pop();
      }
    }
  };
  if (ids.length) dfs(ids[0]);
  const rpo = post.reverse();
  const into = new Map<string, Edge[]>(ids.map(b => [b, []]));
  for (const e of edges) into.get(e.to)!.push(e);
  const freq = new Map<string, number>(ids.map(b => [b, 0]));
  for (let sweep = 0; sweep < 200; sweep++) {
    let delta = 0;
    for (const b of rpo) {
      let v = b === ids[0] ? 1 : 0;
      for (const e of into.get(b)!) v += freq.get(e.from)! * e.prob;
      v = Math.min(v, 1e9);
      delta = Math.max(delta, Math.abs(v - freq.get(b)!) / Math.max(1, v));
      freq.set(b, v);
    }
    if (delta < 1e-9) break;
  }
  return { block: freq, edges };
}

/**
 * The estimated instructions one call executes: each finished instruction weighs the frequency of the IR block
 * whose label precedes it; the prologue (before the first block) and the epilogue (after `exit`) weigh 1.
 */
export function estimateCost(code: readonly MInsn[], fr: Frequencies): number {
  let weight = 1,
    cost = 0;
  for (const m of code) {
    if (m.op === 'label') {
      if (m.name === 'exit') weight = 1;
      else if (fr.block.has(m.name!)) weight = fr.block.get(m.name!)!;
      continue;
    }
    cost += weight;
  }
  return cost;
}
