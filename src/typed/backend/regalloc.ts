/**
 * Register allocation by linear scan: liveness over the machine code (per block, then per instruction), one
 * interval per virtual register, and a scan in start order that gives each interval a free register that does
 * not clash, or spills. A port of Compiler Workbench's backend.js `machineBlocks`, `intervals` and `allocate`.
 *
 * The pools: `t0`-`t4` and, in leaf functions, `a0`-`a7` (caller-saved: a call may destroy them), and `s1`-`s11`
 * (callee-saved: a function that uses one must restore it). `t5` and `t6` are kept back as spill scratch; `s0`,
 * `sp`, `ra`, `gp` and `tp` are never allocated. An interval that spans a call must be in a callee-saved register,
 * or spilled.
 */
import type { BackendOptions } from './options.js';
import { A0, ARGS, CALLEE, CALLER, isBranch, isTerminal, type MInsn } from './encode.js';

export const usesOf = (m: MInsn): number[] =>
  [m.rs1, m.rs2].filter((r): r is number => r !== undefined && r >= 64);
export const defsOf = (m: MInsn): number[] =>
  m.rd !== undefined && m.rd >= 64 && m.op !== 'label' ? [m.rd] : [];

export interface MachineBlock {
  readonly start: number;
  end: number;
  readonly labels: string[];
  readonly succ: number[];
}

/** Basic blocks of machine code: a label or the instruction after a branch or terminal starts one. */
export function machineBlocks(code: readonly MInsn[]): MachineBlock[] {
  const blocks: MachineBlock[] = [],
    at = new Map<string, number>();
  let cur: MachineBlock | null = null;
  code.forEach((m, i) => {
    if (m.op === 'label' || !cur) {
      cur = { start: i, end: i, labels: [], succ: [] };
      blocks.push(cur);
    }
    if (m.op === 'label') {
      cur.labels.push(m.name!);
      at.set(m.name!, blocks.length - 1);
    }
    cur.end = i;
    if (isBranch(m.op) || isTerminal(m.op)) cur = null;
  });
  blocks.forEach((b, k) => {
    const last = code[b.end];
    if (isBranch(last.op)) b.succ.push(at.get(last.target!)!);
    if (last.op === 'j') b.succ.push(at.get(last.target!)!);
    if (!isTerminal(last.op) && k + 1 < blocks.length) b.succ.push(k + 1);
  });
  return blocks;
}

export interface Interval {
  readonly reg: number;
  start: number;
  end: number;
  uses: number;
  crossesCall: boolean;
}

export interface Intervals {
  /** Sorted by start, then register. */
  readonly list: Interval[];
  readonly blocks: MachineBlock[];
  readonly liveOut: Set<number>[];
}

/**
 * One interval per virtual register, from its first definition or use to its last, stretched over whole blocks
 * where it is live in (to the block's start) or live out (to just past its end).
 */
export function intervals(code: readonly MInsn[]): Intervals {
  const blocks = machineBlocks(code);
  const use = blocks.map(() => new Set<number>()),
    def = blocks.map(() => new Set<number>());
  blocks.forEach((b, k) => {
    for (let i = b.start; i <= b.end; i++) {
      for (const r of usesOf(code[i])) if (!def[k].has(r)) use[k].add(r);
      for (const r of defsOf(code[i])) def[k].add(r);
    }
  });
  const IN = blocks.map(() => new Set<number>()),
    OUT = blocks.map(() => new Set<number>());
  for (let changed = true; changed; ) {
    changed = false;
    for (let k = blocks.length - 1; k >= 0; k--) {
      const out = new Set<number>();
      for (const s of blocks[k].succ) for (const r of IN[s]) out.add(r);
      const inn = new Set(use[k]);
      for (const r of out) if (!def[k].has(r)) inn.add(r);
      if (inn.size !== IN[k].size || out.size !== OUT[k].size) {
        IN[k] = inn;
        OUT[k] = out;
        changed = true;
      }
    }
  }
  const iv = new Map<number, Interval>();
  const touch = (r: number, i: number) => {
    const x = iv.get(r);
    if (!x) iv.set(r, { reg: r, start: i, end: i, uses: 1, crossesCall: false });
    else {
      x.start = Math.min(x.start, i);
      x.end = Math.max(x.end, i);
      x.uses++;
    }
  };
  blocks.forEach((b, k) => {
    for (const r of IN[k]) touch(r, b.start);
    for (const r of OUT[k]) touch(r, b.end + 0.5);
    for (let i = b.start; i <= b.end; i++) {
      for (const r of usesOf(code[i])) touch(r, i);
      for (const r of defsOf(code[i])) touch(r, i);
    }
  });
  const calls = code.map((m, i) => (m.op === 'call' ? i : -1)).filter(i => i >= 0);
  for (const x of iv.values()) x.crossesCall = calls.some(c => x.start < c && x.end > c);
  return {
    list: [...iv.values()].sort((a, b) => a.start - b.start || a.reg - b.reg),
    blocks,
    liveOut: OUT,
  };
}

export interface Allocation {
  /** Virtual register -> physical register. */
  readonly assign: Map<number, number>;
  /** Virtual registers that live in stack slots, in the order they were spilled. */
  readonly spilled: Set<number>;
  readonly intervals: readonly Interval[];
}

export function allocate(
  code: readonly MInsn[],
  hintsIn: ReadonlyMap<number, number>,
  o: BackendOptions,
  leaf: boolean,
): Allocation {
  const { list } = intervals(code);
  // caller-saved first; a0..a7 only in leaf functions (a call would clobber them); callee-saved last
  let pool = leaf ? [...CALLER, ...ARGS, ...CALLEE] : [...CALLER, ...CALLEE];
  // s-registers first: every one used is saved and restored
  if (o.order === 'callee') pool = [...CALLEE, ...pool.filter(r => !CALLEE.includes(r))];
  if (o.registers !== 'all') pool = pool.slice(0, Math.max(1, +o.registers));
  const hints = o.hints ? hintsIn : new Map<number, number>();
  // a0..a7 hold the parameters until each is copied: reserve them until then
  const fixed = new Map<number, number>();
  code.forEach((m, i) => {
    if (m.param !== undefined) fixed.set(A0 + m.param, i);
  });
  const assign = new Map<number, number>(),
    spilled = new Set<number>();
  let active: Interval[] = [];
  const free = new Set(pool);
  const okFor = (r: number, x: Interval) =>
    (!x.crossesCall || CALLEE.includes(r)) && !(fixed.has(r) && x.start < fixed.get(r)!);
  for (const x of list) {
    active = active.filter(a => {
      if (a.end <= x.start) {
        free.add(assign.get(a.reg)!);
        return false;
      }
      return true;
    });
    const hint = hints.get(x.reg);
    let r =
      hint !== undefined && free.has(hint) && okFor(hint, x)
        ? hint
        : pool.find(q => free.has(q) && okFor(q, x));
    if (r === undefined) {
      // spill 'furthest': whichever of x and the active intervals it could take a register from ends last
      // spill 'current': always x, the interval that found no register
      const cand =
        o.spill === 'current'
          ? null
          : active.filter(a => okFor(assign.get(a.reg)!, x)).sort((a, b) => b.end - a.end)[0];
      if (cand && cand.end > x.end) {
        r = assign.get(cand.reg)!;
        assign.delete(cand.reg);
        spilled.add(cand.reg);
        active = active.filter(a => a !== cand);
      } else {
        spilled.add(x.reg);
        continue;
      }
    }
    free.delete(r);
    assign.set(x.reg, r);
    active.push(x);
  }
  return { assign, spilled, intervals: list };
}
