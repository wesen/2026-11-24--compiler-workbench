/**
 * Copy coalescing (IRWB-003): a copy `rd <- rs` between two virtual registers of one class disappears when the
 * two can share a register, that is when they do not interfere (Chaitin): neither is defined at a point where the
 * other is live afterwards, except by a copy between them, after which both hold the same value (and, IRWB-034-G,
 * by a copy from a register the other was copied from earlier in the block, with neither changed since).
 *
 *   live-after per instruction, backwards over the machine blocks (as the allocator computes liveness)
 *   edges:  r -- q  for each definition of r with q of r's class live after it, unless the definition copies q
 *   copies, hottest block first: if find(rd) and find(rs) have no edge between them, merge them
 *   rename every virtual register to its representative; a copy that became `r <- r` is dropped
 *
 * Runs between selection and allocation, on the selected code. Copies from or to a physical register
 * (parameters, call results, return values) are left to the allocator's hints. Merging lengthens intervals,
 * which under linear scan can cost a callee-saved register or a spill, so the caller compares estimates.
 */
import { liveness } from '../../stdlib/index.js';
import { machineBlocks, usesOf, defsOf } from './regalloc.js';
import type { MInsn } from './encode.js';
import type { Frequencies } from './frequency.js';
import type { Selection } from './select.js';

export interface Coalesced {
  readonly sel: Selection;
  /** How many copies were removed. */
  readonly removed: number;
}

export function coalesceCopies(sel: Selection, fr: Frequencies | null = null): Coalesced {
  const code = sel.code;
  const cls = (r: number) => (sel.fregs.has(r) ? 'f' : 'x');
  const isCopy = (m: MInsn) =>
    m.mv && m.rd !== undefined && m.rs1 !== undefined && m.rd >= 64 && m.rs1 >= 64 && m.rd !== m.rs1;
  // liveness per block, then per instruction backwards
  const blocks = machineBlocks(code);
  const use = blocks.map(() => new Set<number>()),
    def = blocks.map(() => new Set<number>());
  blocks.forEach((b, k) => {
    for (let i = b.start; i <= b.end; i++) {
      for (const r of usesOf(code[i])) if (!def[k].has(r)) use[k].add(r);
      for (const r of defsOf(code[i])) def[k].add(r);
    }
  });
  const { liveOut: OUT } = liveness(
    blocks.map((b, k) => ({ successors: b.succ, uses: use[k], definitions: def[k] })),
  );
  // IRWB-034-G: at a copy `rd <- rs`, the registers that an earlier copy in the block set from the same rs, with
  // neither side redefined since, hold the value rd receives. The definition does not make them interfere with rd
  // (the argument of the copy exception itself), so `a <- s; b <- s` can end up as one register.
  const sameAsSource = new Map<number, Set<number>>();
  for (const b of blocks) {
    const copyOf = new Map<number, number>();
    for (let i = b.start; i <= b.end; i++) {
      const m = code[i];
      if (isCopy(m)) {
        const same = [...copyOf].filter(([, s]) => s === m.rs1).map(([q]) => q);
        if (same.length) sameAsSource.set(i, new Set(same));
      }
      for (const r of defsOf(m)) {
        copyOf.delete(r);
        for (const [q, s] of copyOf) if (s === r) copyOf.delete(q);
      }
      if (isCopy(m)) copyOf.set(m.rd!, m.rs1!);
    }
  }
  const adj = new Map<number, Set<number>>();
  const edge = (a: number, b: number) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  blocks.forEach((b, k) => {
    const live = new Set(OUT[k]);
    for (let i = b.end; i >= b.start; i--) {
      const m = code[i];
      for (const r of defsOf(m)) {
        const copy = isCopy(m),
          same = copy ? sameAsSource.get(i) : undefined;
        for (const q of live)
          if (q !== r && cls(q) === cls(r) && !(copy && (q === m.rs1 || same?.has(q)))) edge(r, q);
        live.delete(r);
      }
      for (const r of usesOf(m)) live.add(r);
    }
  });
  // the block frequency of each instruction, for the order of the candidates
  const weight: number[] = [];
  let w = 1;
  for (const m of code) {
    if (m.op === 'label' && fr) {
      if (m.name === 'exit') w = 1;
      else if (fr.block.has(m.name!)) w = fr.block.get(m.name!)!;
    }
    weight.push(w);
  }
  const candidates = code
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => isCopy(m) && cls(m.rd!) === cls(m.rs1!))
    .sort((a, b) => weight[b.i] - weight[a.i] || a.i - b.i);
  // union-find; the representative keeps the union of its members' edges (by member id)
  const parent = new Map<number, number>();
  const find = (r: number): number => {
    let x = r;
    while (parent.has(x)) x = parent.get(x)!;
    let y = r;
    while (parent.has(y)) {
      const n = parent.get(y)!;
      parent.set(y, x);
      y = n;
    }
    return x;
  };
  const members = new Map<number, number[]>();
  const membersOf = (r: number) => members.get(r) ?? [r];
  const interferes = (a: number, b: number) => {
    const [small, big] = membersOf(a).length <= membersOf(b).length ? [a, b] : [b, a];
    for (const x of membersOf(small)) for (const y of adj.get(x) ?? []) if (find(y) === big) return true;
    return false;
  };
  const hints = new Map(sel.hints);
  for (const { m } of candidates) {
    const a = find(m.rd!),
      b = find(m.rs1!);
    if (a === b || interferes(a, b)) continue;
    // the lower register stays the representative, so the result does not depend on hash order
    const [rep, other] = a < b ? [a, b] : [b, a];
    parent.set(other, rep);
    members.set(rep, [...membersOf(rep), ...membersOf(other)]);
    members.delete(other);
    if (!hints.has(rep) && hints.has(other)) hints.set(rep, hints.get(other)!);
  }
  const ren = (r: number | undefined) => (r === undefined || r < 64 ? r : find(r));
  let removed = 0;
  const out: MInsn[] = [];
  for (const m of code) {
    const n: MInsn = { ...m };
    if (m.op !== 'label') {
      if (m.rd !== undefined) n.rd = ren(m.rd);
      if (m.rs1 !== undefined) n.rs1 = ren(m.rs1);
      if (m.rs2 !== undefined) n.rs2 = ren(m.rs2);
    }
    if (n.mv && n.rd !== undefined && n.rd >= 64 && n.rd === n.rs1) {
      removed++;
      continue;
    }
    out.push(n);
  }
  const outHints = new Map<number, number>();
  for (const [r, p] of hints) if (!outHints.has(find(r))) outHints.set(find(r), p);
  return {
    sel: {
      ...sel,
      code: out,
      hints: outHints,
      localReg: sel.localReg.map(r => find(r)),
    },
    removed,
  };
}
