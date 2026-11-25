/**
 * Register allocation by linear scan: liveness over the machine code (per block, then per instruction), one
 * interval per virtual register, and a scan in start order that gives each interval a free register that does
 * not clash, or spills. A port of Compiler Workbench's backend.js `machineBlocks`, `intervals` and `allocate`.
 *
 * The pools: `t0`-`t4` and, in leaf functions, `a0`-`a7` (caller-saved: a call may destroy them), and `s1`-`s11`
 * (callee-saved: a function that uses one must restore it). `t5` and `t6` are kept back as spill scratch; `s0`,
 * `sp`, `ra`, `gp` and `tp` are never allocated. An interval that spans a call must be in a callee-saved register,
 * or spilled.
 *
 * f32 values are a second class with its own pools: `ft0`-`ft9` and, in leaf functions, `fa0`-`fa7` (caller-saved),
 * and `fs0`-`fs11` (callee-saved); `ft10` and `ft11` are its spill scratch. The two classes are scanned separately:
 * an interval only ever receives a register of its own class, and the options apply to each class.
 */
import type { BackendOptions } from './options.js';
import {
  ARGS,
  CALLEE,
  CALLER,
  F_ARGS,
  F_CALLEE,
  F_CALLER,
  isBranch,
  isTerminal,
  type MInsn,
} from './encode.js';

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

/**
 * Where the physical registers `tracked` (at most 31) are occupied: for each, a prefix count over the instructions
 * of the positions where it is live in or written. A call reads its argument registers (`uses`) and writes every
 * tracked register (they are caller-saved); a return reads its result registers; the parameters are live from the
 * entry until their copies. Liveness is computed over the machine blocks, as for virtual registers.
 */
export function physicalOccupancy(
  code: readonly MInsn[],
  tracked: readonly number[],
): { occupied(r: number, from: number, to: number): boolean; liveOut(r: number, at: number): boolean } {
  const bit = new Map(tracked.map((r, i) => [r, 1 << i]));
  const all = (1 << tracked.length) - 1;
  const n = code.length;
  const use = new Int32Array(n),
    def = new Int32Array(n);
  code.forEach((m, i) => {
    let u = 0;
    for (const r of [m.rs1, m.rs2, ...(m.uses ?? [])]) if (r !== undefined && bit.has(r)) u |= bit.get(r)!;
    use[i] = u;
    def[i] =
      m.op === 'call' ? all : m.op !== 'label' && m.rd !== undefined && bit.has(m.rd) ? bit.get(m.rd)! : 0;
  });
  const blocks = machineBlocks(code);
  const bUse = blocks.map(b => {
      let u = 0,
        d = 0;
      for (let i = b.start; i <= b.end; i++) {
        u |= use[i] & ~d;
        d |= def[i];
      }
      return [u, d];
    }),
    IN = new Int32Array(blocks.length),
    OUT = new Int32Array(blocks.length);
  for (let changed = true; changed; ) {
    changed = false;
    for (let k = blocks.length - 1; k >= 0; k--) {
      let out = 0;
      for (const s of blocks[k].succ) out |= IN[s];
      const inn = bUse[k][0] | (out & ~bUse[k][1]);
      if (inn !== IN[k] || out !== OUT[k]) {
        IN[k] = inn;
        OUT[k] = out;
        changed = true;
      }
    }
  }
  const liveIn = new Int32Array(n),
    liveAfter = new Int32Array(n);
  blocks.forEach((b, k) => {
    let live = OUT[k];
    for (let i = b.end; i >= b.start; i--) {
      liveAfter[i] = live;
      live = (live & ~def[i]) | use[i];
      liveIn[i] = live;
    }
  });
  // prefix counts of the occupied positions (live in or written) per tracked register
  const prefix = tracked.map((r, j) => {
    const p = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) p[i + 1] = p[i] + (((liveIn[i] | def[i]) >> j) & 1);
    return p;
  });
  const index = new Map(tracked.map((r, j) => [r, j]));
  return {
    // whether r is occupied at some position p with from <= p <= to
    occupied: (r, from, to) => {
      const p = prefix[index.get(r)!];
      return to >= from && p[Math.min(n, to + 1)] - p[Math.max(0, from)] > 0;
    },
    liveOut: (r, at) => ((liveAfter[at] >> index.get(r)!) & 1) === 1,
  };
}

/** A register class's pools: caller-saved, the argument registers (leaf functions only), callee-saved. */
interface ClassPools {
  readonly caller: readonly number[];
  readonly args: readonly number[];
  readonly callee: readonly number[];
}
const X_POOLS: ClassPools = { caller: CALLER, args: ARGS, callee: CALLEE };
const F_POOLS: ClassPools = { caller: F_CALLER, args: F_ARGS, callee: F_CALLEE };

/**
 * Linear scan, one register class at a time. `fregs` names the virtual registers of class f; every other virtual
 * register is of class x.
 */
export function allocate(
  code: readonly MInsn[],
  hintsIn: ReadonlyMap<number, number>,
  o: BackendOptions,
  leaf: boolean,
  fregs: ReadonlySet<number> = new Set(),
): Allocation {
  const { list } = intervals(code);
  const hints = o.hints ? hintsIn : new Map<number, number>();
  // the argument registers hold the parameters until each is copied: reserve each until then
  const fixed = new Map<number, number>();
  code.forEach((m, i) => {
    if (m.param !== undefined && m.rs1 !== undefined && m.rs1 < 64) fixed.set(m.rs1, i);
  });
  // a record return writes its result registers one after another: a value live across one of those writes
  // (it is still to be moved) may not live in that register
  const pins = new Map<number, number[]>();
  code.forEach((m, i) => {
    if (m.pins && m.rd !== undefined && m.rd < 64) pins.set(m.rd, [...(pins.get(m.rd) ?? []), i]);
  });
  const assign = new Map<number, number>(),
    spilled = new Set<number>();
  // the f class in a function that calls: fa0-fa7 are allocatable wherever their physical uses leave them free
  const shared = !leaf && fregs.size > 0 ? physicalOccupancy(code, F_ARGS) : null;
  /**
   * Whether interval x would clash with the physical uses of argument register r: r is occupied strictly inside x,
   * or still live after x's definition (unless that definition copies r, so both hold one value).
   */
  const clashes = (r: number, x: Interval): boolean => {
    if (!shared) return false;
    const s = x.start,
      last = Number.isInteger(x.end) ? x.end - 1 : Math.floor(x.end);
    if (shared.occupied(r, s + 1, last)) return true;
    const d = code[s];
    return shared.liveOut(r, s) && !(d.mv && d.rs1 === r);
  };
  const scan = (pools: ClassPools, xs: readonly Interval[], argsShared: boolean): void => {
    // caller-saved first; argument registers in leaf functions (a call would clobber them), or where their physical
    // uses leave them free (argsShared); callee-saved last
    let pool =
      leaf || argsShared
        ? [...pools.caller, ...pools.args, ...pools.callee]
        : [...pools.caller, ...pools.callee];
    // s-registers first: every one used is saved and restored
    if (o.order === 'callee') pool = [...pools.callee, ...pool.filter(r => !pools.callee.includes(r))];
    if (o.registers !== 'all') pool = pool.slice(0, Math.max(1, +o.registers));
    let active: Interval[] = [];
    const free = new Set(pool);
    const okFor = (r: number, x: Interval) =>
      (!x.crossesCall || pools.callee.includes(r)) &&
      !(fixed.has(r) && x.start < fixed.get(r)!) &&
      !pins.get(r)?.some(i => x.start < i && i < x.end) &&
      !(argsShared && !leaf && pools.args.includes(r) && clashes(r, x));
    for (const x of xs) {
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
  };
  // the x class as Compiler Workbench allocates it (so integer images stay the book's); the f class also shares fa0-fa7
  scan(
    X_POOLS,
    list.filter(x => !fregs.has(x.reg)),
    false,
  );
  scan(
    F_POOLS,
    list.filter(x => fregs.has(x.reg)),
    shared !== null,
  );
  return { assign, spilled, intervals: list };
}
