/**
 * Partial evaluation over bound parameters and constant buffers (IRWB-036-E, first Futamura projection).
 *
 * A function whose buffer parameter's contents a host promise fixes (`typed.bindings`, buffer form) is an
 * interpreter of those bytes; the `peval` pass specializes it on them and the residual is the program the bytes
 * encode, as ordinary checked `typed.blocks`:
 *
 *   - the promise is checked as a field binding is: a store through an address derived from the bound parameter
 *     refuses the pass (`checkBufferBinding` in specialize.ts);
 *   - a scalar parameter whose input spec is `oneOf` — the same domain the meaning contract generates cases from —
 *     is split polyvariantly: the residual entry is a `br_if` chain over the promised values, each arm traced with
 *     the parameter constant; values outside the promise trap (the contract never generates them);
 *   - the trace follows original blocks while the abstract state stays precise: a fetch from the constant buffer
 *     at a static index folds, the dispatch on a folded opcode folds, and a whole guest instruction becomes pure
 *     residual arithmetic. A *region* (one residual block) ends when a branch reaches an already-seen (block,
 *     state) — the memo closes the loop there — or at a dynamic condition, which cuts both arms into new regions,
 *     or at return/trap;
 *   - the abstract state maps IR locals to a constant, a residual value id, or "in its own slot", and
 *     frame-array words ("cells") to a constant, a residual value id, or a fresh local. When a statement
 *     overwrites a local that some pending value reads, that value is materialized first, so every residual value
 *     is computed before anything it reads changes; at region cuts, value ids become `set` statements into their
 *     locals (the ones the target never reads are dead and removed by `dce`).
 *
 * Two arrivals at one program point are the same region when their live IR locals and *all* cells agree —
 * constants exactly, locals in use by identity; a pending value counts as "in use" wherever it is. When two
 * arrivals differ (a cell that was constant on the first trip and dynamic from the second, e.g. the Fibonacci
 * value that starts at 0), the pass does not merge: it traces the second arrival as its own region, which peels
 * the first trip off the loop and lets the steady-state loop close on itself. That is the polyvariance; budgets
 * (regions, traced blocks, residual statements, split values) refuse anything larger and leave the function
 * unchanged, with the reason recorded in the revision report.
 *
 * This trace is the binding-time analysis: it propagates the buffer promise through `caddr`/`load16u` chains and
 * reports, per region, what folded and what stayed dynamic.
 */
import { definePass } from '../framework/passes/define-pass.js';
import type { Artifact } from '../framework/core/types.js';
import type { DataflowResult } from '../framework/dataflow/analysis.js';
import type { ProgramInputs } from './evaluate.js';
import { ANALYSES, hasEffect, liveView } from './analyses.js';
import { BlocksIR, blocksAdapter } from './ir.js';
import type { BlockRec, StmtRec, TypedBlocks, ValueRec, WorkFn } from './model.js';
import { Store } from './model.js';
import type { CorrespondenceEntry } from '../framework/ir/types.js';
import type { RevisionReport, TypedPass } from './passes.js';
import { checkBufferBinding, factRef, isBufferBinding, type Binding, type Bindings } from './bindings.js';
import { Tx, TxError, type Edit } from './tx.js';

/** The budgets: anything larger is refused (the function is left unchanged), never truncated. */
export const PEVAL_LIMITS = Object.freeze({
  /** Split values per entry parameter (the corpus VM has two; a longer chain costs one branch each). */
  maxSplits: 8,
  /** Regions (memo entries), i.e. distinct specialized program points. The corpus VM's residuals need 12. */
  maxRegions: 256,
  /** Original blocks traced, including re-traced dispatch chains. */
  maxBlocks: 4096,
  /** Residual statements: the real size guard. The corpus VM's residuals are under 40 statements each. */
  maxStmts: 2048,
});

export interface PEvalParams {
  /** The host promises: buffer bindings (and exact scalar bindings) as a `typed.bindings` artifact. */
  readonly bindings?: Artifact<Bindings>;
  /** The case domain the meaning contract uses; `oneOf` scalar specs are split on. */
  readonly inputs?: ProgramInputs;
}

const ABOUT =
  'partial evaluation: a function with a bound buffer is traced on the promised bytes and replaced by its residual';

/** A budget was exceeded: the function is left unchanged, with this reason in the report. */
class PELimit extends Error {
  constructor(what: string) {
    super(`${what} (the ${PEVAL_LIMITS.maxRegions}-region / ${PEVAL_LIMITS.maxStmts}-statement budget)`);
  }
}

/** A folded `caddr` proved the program traps here (position ≥ the promised capacity). */
class TrapSignal extends Error {
  constructor(readonly at: string) {
    super('the checked address traps');
  }
}

const FOLDABLE = [
  'add', 'sub', 'mul', 'shl', 'shr', 'shru', 'and', 'or', 'xor',
  'eq', 'ne', 'lt', 'gt', 'le', 'ge', 'ltu', 'geu',
] as const;

// ---------- the abstract domain ----------
/** An IR local: a constant, a residual value id (valid in this block), a folded address, or in its own slot. */
type LocState =
  | { readonly k: 'c'; readonly n: number }
  | { readonly k: 'v'; readonly id: string }
  | { readonly k: 'a'; readonly addr: Addr; readonly from: string }
  | { readonly k: 'd' };
/** A frame-array word: a constant, a residual value id, or a fresh local the pass allocated. */
type CellState =
  | { readonly k: 'c'; readonly n: number }
  | { readonly k: 'v'; readonly id: string }
  | { readonly k: 'm'; readonly local: number };
/** An address: a frame-array byte, or byte `b` of bound buffer parameter `p`, or unknown. */
type Addr =
  | { readonly k: 'f'; readonly b: number }
  | { readonly k: 'c'; readonly b: number; readonly p: number }
  | { readonly k: 'd' };
/** A value: a constant, a residual value id, or (for address-valued trees) a folded address. */
type Abs =
  | { readonly k: 'c'; readonly n: number }
  | { readonly k: 'v'; readonly id: string }
  | { readonly k: 'a'; readonly addr: Addr };

interface Sigma {
  loc: LocState[];
  cell: Map<number, CellState>;
}

const copySigma = (s: Sigma): Sigma => ({ loc: s.loc.slice(), cell: new Map(s.cell) });

/** The class of a state for a memo key: a pending value is "in use" (its identity is block-local and never crosses). */
const cls = (s: LocState | CellState): (string | number)[] =>
  s.k === 'c'
    ? ['c', s.n]
    : s.k === 'd'
      ? ['d']
      : s.k === 'm'
        ? ['m', s.local]
        : s.k === 'a'
          ? ['a', s.addr.k, s.addr.k === 'd' ? 0 : s.addr.b]
          : ['v'];

/** The memo key of (original block, state): the live IR locals, and every cell, by class and constant. */
function keyOf(block: string, sigma: Sigma, live: ReadonlySet<number>): string {
  const locs = [...live]
    .sort((a, b) => a - b)
    .map(l => [l, cls(sigma.loc[l])]);
  const cells = [...sigma.cell.keys()]
    .sort((a, b) => a - b)
    .map(b => [b, cls(sigma.cell.get(b)!)]);
  return JSON.stringify([block, locs, cells]);
}

/** i32 arithmetic as the target computes it; div/rem by zero never fold (the original traps there). */
function fold(op: string, a: number, b?: number): number | undefined {
  switch (op) {
    case 'add':
      return (a + (b as number)) | 0;
    case 'sub':
      return (a - (b as number)) | 0;
    case 'mul':
      return Math.imul(a, b as number);
    case 'div':
      return !b ? undefined : (a / b) | 0;
    case 'rem':
      return !b ? undefined : a % b;
    case 'and':
      return a & (b as number);
    case 'or':
      return a | (b as number);
    case 'xor':
      return a ^ (b as number);
    case 'shl':
      return a << (b as number);
    case 'shr':
      return a >> (b as number);
    case 'shru':
      return a >>> (b as number);
    case 'eq':
      return a === b ? 1 : 0;
    case 'ne':
      return a !== b ? 1 : 0;
    case 'lt':
      return a < (b as number) ? 1 : 0;
    case 'gt':
      return a > (b as number) ? 1 : 0;
    case 'le':
      return a <= (b as number) ? 1 : 0;
    case 'ge':
      return a >= (b as number) ? 1 : 0;
    case 'ltu':
      return a >>> 0 < (b as number) >>> 0 ? 1 : 0;
    case 'geu':
      return a >>> 0 >= (b as number) >>> 0 ? 1 : 0;
    default:
      return undefined;
  }
}

/** One traced region (one residual block), for the report's binding-time profile. */
export interface PEvalRegion {
  readonly block: string;
  readonly residual: string;
  statements: number;
  folds: number;
  readonly note: string;
}

/** The tracer for one function: the memo, the worklist and the emission into residual blocks. */
class Tracer {
  readonly memo = new Map<string, string>();
  readonly work: { block: string; sigma: Sigma; into: string }[] = [];
  readonly regions: PEvalRegion[] = [];
  readonly cellLocals = new Map<number, number>();
  folds = 0;
  private stmts = 0;
  private traced = 0;
  private used = new Set<string>();
  /** The (block, state) points this region has already passed through, for closing in-region cycles. */
  private visited = new Set<string>();
  private sigma: Sigma = { loc: [], cell: new Map() };

  constructor(
    readonly tx: Tx,
    readonly src: Store,
    readonly f: WorkFn,
    readonly live: ReturnType<typeof liveView>,
    /** the promised cells, per buffer parameter index */
    readonly mem: Map<number, readonly number[]>,
    readonly because: readonly string[],
  ) {}

  private opt(from: string, note?: string) {
    return { from, because: this.because, ...(note ? { note } : {}) };
  }

  /** A fresh local for a frame cell (lazily, one per cell). */
  private cellLocal(b: number): number {
    let m = this.cellLocals.get(b);
    if (m === undefined) {
      m = this.tx.local(`pe.m${b}`, this.opt('', `frame byte ${b} of ${this.f.name}, held in a local`));
      this.cellLocals.set(b, m);
    }
    return m;
  }

  /** Reference a residual value; a value has one user, so a second reference clones the tree. */
  private use(id: string): string {
    if (this.used.has(id)) return this.clone(id);
    this.used.add(id);
    return id;
  }
  private clone(id: string): string {
    const v = this.tx.st.get(id) as ValueRec;
    const args = v.args.map(a => this.clone(a));
    return this.tx.make(v.op, ...args, {
      imm: v.imm,
      type: v.type ?? 'i32',
      from: id,
      because: this.because,
      note: 'cloned: this value is needed twice',
    });
  }

  /** Whether a residual value tree reads local `l`. */
  private reads(id: string, l: number, seen = new Set<string>()): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    const v = this.tx.st.get(id) as ValueRec;
    if (!v) return false;
    if (v.op === 'get' && v.imm === l) return true;
    return v.args.some(a => this.reads(a, l, seen));
  }

  private place(block: BlockRec, sid: string, note: string): void {
    this.tx.insert(this.tx.at.end(block), sid, { because: this.because, note });
    if (++this.stmts > PEVAL_LIMITS.maxStmts) throw new PELimit('too many residual statements');
  }

  /** Whether any pending value (in a cell or a local) reads `local`. */
  private pending(local: number): boolean {
    for (const c of this.sigma.cell.values()) if (c.k === 'v' && this.reads(c.id, local)) return true;
    for (const s of this.sigma.loc) if (s && s.k === 'v' && this.reads(s.id, local)) return true;
    return false;
  }

  /**
   * `local` is about to be overwritten by a residual statement: every pending value (in a cell or in a local)
   * that reads it must be computed now, before the overwrite — this is what keeps residual values in the right
   * order. Materializing one value overwrites its own local in turn, so its readers go first, transitively; a
   * cycle of pending values cannot be ordered and refuses the function. (The `set` for a cell nobody later reads
   * is dead code; `dce` removes it.)
   */
  private invalidate(local: number, block: BlockRec, depth = 0): void {
    if (depth > 32) throw new TxError('unsupported', 'peval: a cycle of pending values at a branch');
    for (const [b, c] of [...this.sigma.cell])
      if (c.k === 'v' && this.reads(c.id, local)) {
        const m = this.cellLocal(b);
        this.sigma.cell.set(b, { k: 'm', local: m }); // first, so the recursion cannot revisit it
        this.invalidate(m, block, depth + 1);
        this.place(
          block,
          this.tx.set(m, this.use(c.id), this.opt(c.id, `frame byte ${b}, before ${this.f.locals[local].name} changes`)),
          'a pending value reads a local about to change',
        );
      }
    for (let i = 0; i < this.sigma.loc.length; i++) {
      const s = this.sigma.loc[i];
      if (s && s.k === 'v' && this.reads(s.id, local)) {
        this.sigma.loc[i] = { k: 'd' };
        this.invalidate(i, block, depth + 1);
        this.place(
          block,
          this.tx.set(i, this.use(s.id), this.opt(s.id, `${this.f.locals[i].name}, before ${this.f.locals[local].name} changes`)),
          'a pending value reads a local about to change',
        );
      }
    }
  }

  /**
   * A region cut: value ids cannot cross a block boundary, so every cell holding one gets a `set` into its local
   * and every *live* IR local holding one is written to its own slot (`liveIn` of the target, from the framework's
   * liveness over the original blocks the trace follows). The `set`s for cells the target never reads are dead;
   * `dce` removes them.
   */
  private materialize(live: ReadonlySet<number>, block: BlockRec): void {
    for (const [b, c] of [...this.sigma.cell])
      if (c.k === 'v') {
        const m = this.cellLocal(b);
        this.sigma.cell.set(b, { k: 'm', local: m });
        this.invalidate(m, block); // readers of this local are computed first
        this.place(block, this.tx.set(m, this.use(c.id), this.opt(c.id, `frame byte ${b} at a branch`)), 'a value cannot cross a block boundary');
      }
    for (const l of live) {
      const s = this.sigma.loc[l];
      if (s && s.k === 'a') {
        this.place(
          block,
          this.tx.set(l, this.resid(s.from), this.opt(s.from, `${this.f.locals[l].name} at a branch`)),
          'an address cannot cross a block boundary either',
        );
        this.sigma.loc[l] = { k: 'd' };
      }
      if (s && s.k === 'v') {
        this.sigma.loc[l] = { k: 'd' };
        this.invalidate(l, block); // readers of this local are computed first
        this.place(
          block,
          this.tx.set(l, this.use(s.id), this.opt(s.id, `${this.f.locals[l].name} at a branch`)),
          'a value cannot cross a block boundary',
        );
      }
    }
  }

  /** A residual tree for a source value: constants stay constants, dynamic parts become value nodes. */
  private resid(id: string): string {
    const v = this.src.get(id) as ValueRec;
    if (v.op === 'const') return this.tx.const(v.imm as number, this.opt(id));
    if (v.op === 'get') {
      const s = this.sigma.loc[v.imm as number];
      if (s && s.k === 'c') return this.tx.const(s.n, this.opt(id, 'the local holds this constant here'));
      if (s && s.k === 'v') return this.use(s.id);
      return this.tx.get(v.imm as number, this.opt(id));
    }
    const args = v.args.map(a => this.resid(a));
    return this.tx.make(v.op, ...args, { imm: v.imm, type: v.type ?? 'i32', from: id, because: this.because });
  }

  /** A residual value node for an already-evaluated argument: constants stay, values are used, addresses rebuild. */
  private absNode(a: Abs, from: string): string {
    if (a.k === 'c') return this.tx.const(a.n, this.opt(from));
    if (a.k === 'v') return this.use(a.id);
    return this.resid(from);
  }

  /** Evaluate a source value in the current state: fold it, track its address, or residualize it. */
  private eval(id: string): Abs {
    const v = this.src.get(id) as ValueRec;
    if (!['const', 'get', 'aaddr', 'caddr', 'load', 'load16u', 'eqz', ...FOLDABLE].includes(v.op))
      throw new TxError('unsupported', `peval: value op "${v.op}" is outside the supported domain (${id})`);
    if (v.op === 'const') return { k: 'c', n: v.imm as number };
    if (v.op === 'get') {
      const s = this.sigma.loc[v.imm as number];
      if (s === undefined) throw new TxError('unsupported', `peval: local ${v.imm} has no state at ${id}`);
      return s.k === 'c'
        ? { k: 'c', n: s.n }
        : s.k === 'v'
          ? { k: 'v', id: s.id }
          : s.k === 'a'
            ? { k: 'a', addr: s.addr }
            : { k: 'v', id: this.tx.get(v.imm as number, this.opt(id)) };
    }
    if (v.op === 'aaddr') return { k: 'a', addr: { k: 'f', b: v.imm as number } };
    if (v.op === 'eqz') {
      const a = this.eval(v.args[0]);
      if (a.k === 'c') {
        this.folds++;
        return { k: 'c', n: a.n === 0 ? 1 : 0 };
      }
      return { k: 'v', id: this.tx.make('eqz', this.absNode(a, v.args[0]), this.opt(id)) };
    }
    if (v.op === 'caddr') {
      const recv = this.src.get(v.args[0]) as ValueRec;
      const pos = this.eval(v.args[1]);
      if (recv.op === 'get' && this.mem.has(recv.imm as number) && pos.k === 'c') {
        const len = this.mem.get(recv.imm as number)!.length;
        if (pos.n >>> 0 >= len) throw new TrapSignal(id);
        this.folds++;
        return { k: 'a', addr: { k: 'c', b: 2 * pos.n, p: recv.imm as number } };
      }
      return { k: 'v', id: this.resid(id) };
    }
    if (v.op === 'load16u' || v.op === 'load') {
      if (v.type === 'f32')
        throw new TxError('unsupported', `peval: ${id} is an f32 load, outside the supported domain`);
      const a = this.eval(v.args[0]);
      const off = (v.imm as number | undefined) ?? 0; // the load's byte offset, as the lifter encodes it
      if (a.k === 'a' && a.addr.k === 'c') {
        const cells = this.mem.get(a.addr.p);
        const i = (a.addr.b + off - 4) / 2;
        if (!cells || !Number.isInteger(i) || i < 0 || (v.op === 'load16u' ? i >= cells.length : i + 1 >= cells.length))
          throw new TxError('unsupported', `peval: ${id} reads buffer byte ${a.addr.b + off}, outside the promised cells`);
        this.folds++;
        if (v.op === 'load16u') return { k: 'c', n: cells[i] & 65535 };
        return { k: 'c', n: ((cells[i + 1] << 16) | (cells[i] & 65535)) | 0 };
      }
      if (a.k === 'a' && a.addr.k === 'f' && v.op === 'load') {
        const b = a.addr.b + off;
        if (b % 4 !== 0 || b < 0 || b + 4 > (this.f.arrayBytes ?? 0))
          throw new TxError('unsupported', `peval: ${id} loads outside the word-aligned array area`);
        const c = this.sigma.cell.get(b);
        if (c === undefined) throw new TxError('unsupported', `peval: ${id} reads frame byte ${b} before it is written`);
        this.folds++;
        return c.k === 'c'
          ? { k: 'c', n: c.n }
          : c.k === 'v'
            ? { k: 'v', id: c.id }
            : { k: 'v', id: this.tx.get(c.local, this.opt(id, `frame byte ${b}, in its local`)) };
      }
      return { k: 'v', id: this.resid(id) };
    }
    // binary i32 operators: fold, fold an address computation, or residualize
    const a0 = this.eval(v.args[0]);
    const a1 = v.args.length > 1 ? this.eval(v.args[1]) : undefined;
    if (a0.k === 'c' && (a1 === undefined || a1.k === 'c')) {
      const n = fold(v.op, a0.n, a1?.n);
      if (n !== undefined) {
        this.folds++;
        return { k: 'c', n };
      }
    }
    if (a1) {
      const addr = this.addrBin(v.op, a0, a1);
      if (addr) return addr;
    }
    return {
      k: 'v',
      id: this.tx.make(v.op, this.absNode(a0, v.args[0]), this.absNode(a1!, v.args[1]), this.opt(id)),
    };
  }

  /** Constant address arithmetic: (frame | buffer byte) ± k. A plain constant is an offset, never an address. */
  private addrBin(op: string, x: Abs, y: Abs): Abs | undefined {
    const of = (a: Addr, d: number): Addr =>
      a.k === 'f' ? { k: 'f', b: a.b + d } : a.k === 'c' ? { k: 'c', b: a.b + d, p: a.p } : { k: 'd' };
    const ax = x.k === 'a' ? x.addr : undefined;
    const ay = y.k === 'a' ? y.addr : undefined;
    if (ax && ay) return undefined;
    if (op === 'add') {
      if (ax && y.k === 'c') return { k: 'a', addr: of(ax, y.n) };
      if (ay && x.k === 'c') return { k: 'a', addr: of(ay, x.n) };
    }
    if (op === 'sub' && ax && y.k === 'c') return { k: 'a', addr: of(ax, -y.n) };
    return undefined;
  }

  /** The residual target of a branch: a memo hit, or a fresh region pushed on the worklist. */
  private enter(target: string): string {
    const key = keyOf(target, this.sigma, this.live.liveIn(target));
    const hit = this.memo.get(key);
    if (hit) return hit;
    if (this.memo.size >= PEVAL_LIMITS.maxRegions) throw new PELimit('too many regions');
    const fresh = this.tx.block({ from: target, because: this.because, note: `specialized from ${target}` });
    this.memo.set(key, fresh);
    this.work.push({ block: target, sigma: copySigma(this.sigma), into: fresh });
    return fresh;
  }

  private emit(block: BlockRec, fields: Partial<StmtRec> & { op: StmtRec['op'] }, from: StmtRec): void {
    this.place(block, this.tx.stmt(fields, this.opt(from.id, `from ${from.id}`)), `from ${from.id}`);
  }

  /** One non-terminator statement of the original, in the current state. */
  private stmt(sid: string, block: BlockRec): void {
    const s = this.src.get(sid) as StmtRec;
    switch (s.op) {
      case 'set': {
        const a = this.eval(s.value!);
        this.invalidate(s.local!, block);
        if (a.k === 'c') this.sigma.loc[s.local!] = { k: 'c', n: a.n };
        else if (a.k === 'a') {
          // a local holding a folded address (t18 = frame+16 + operand*4): kept abstract, never emitted
          this.sigma.loc[s.local!] = { k: 'a', addr: a.addr, from: s.value! };
          return;
        } else if (hasEffect(this.tx.st, a.id)) {
          // an effect the folding could not remove (a residual load or checked address): keep the statement
          this.emit(block, { op: 'set', local: s.local!, value: this.use(a.id) }, s);
          this.sigma.loc[s.local!] = { k: 'd' };
        } else this.sigma.loc[s.local!] = { k: 'v', id: a.id };
        return;
      }
      case 'store': {
        const A = this.eval(s.addr!);
        const a = this.eval(s.value!);
        if (a.k === 'a') throw new TxError('unsupported', `peval: ${sid} stores an address`);
        const addr = A.k === 'a' ? A.addr : undefined;
        if (addr?.k === 'c')
          throw new TxError('unsupported', `peval: ${sid} stores into the bound buffer; the promise cannot hold`);
        if (addr?.k === 'f') {
          const b = addr.b + (s.offset ?? 0);
          if (b % 4 !== 0 || b < 0 || b + 4 > (this.f.arrayBytes ?? 0) || s.width === 16)
            throw new TxError('unsupported', `peval: ${sid} is not a word store into the array area`);
          const prev = this.sigma.cell.get(b);
          if (prev?.k === 'm' && (a.k === 'v' || a.k === 'c') && this.pending(prev.local)) {
            // the cell lives in a local and pending values read it: write the local now, so its content is where
            // every later reader (and the cut) expects it; invalidation first keeps pending values in order.
            this.invalidate(prev.local, block);
            this.place(
              block,
              this.tx.set(
                prev.local,
                a.k === 'c' ? this.tx.const(a.n, this.opt(s.value!, 'the stored value is constant here')) : this.use(a.id),
                this.opt(s.value!, `frame byte ${b}, in its local`),
              ),
              `from ${sid}`,
            );
            this.sigma.cell.set(b, { k: 'm', local: prev.local });
          } else if (prev?.k === 'm' && a.k === 'v' && !this.pending(prev.local)) {
            // nothing reads that local: defer the write to the cut (the set the cut emits is dead when the next
            // region overwrites the cell first, and `dce` removes it)
            this.sigma.cell.set(b, { k: 'v', id: a.id });
          } else this.sigma.cell.set(b, a.k === 'c' ? { k: 'c', n: a.n } : { k: 'v', id: a.id });
          return;
        }
        this.emit(
          block,
          {
            op: 'store',
            addr: A.k === 'v' ? this.use(A.id) : this.resid(s.addr!),
            value:
              a.k === 'c'
                ? this.tx.const(a.n, this.opt(s.value!, 'the stored value is constant here'))
                : this.use(a.id),
            width: s.width,
            offset: s.offset,
          },
          s,
        );
        return;
      }
      case 'zero': {
        const from = s.offset ?? 0,
          bytes = s.bytes ?? 0;
        if (from % 4 !== 0 || bytes % 4 !== 0 || from + bytes > (this.f.arrayBytes ?? 0))
          throw new TxError('unsupported', `peval: ${sid} zeroes bytes outside the word-aligned array area`);
        for (let b = from; b < from + bytes; b += 4) this.sigma.cell.set(b, { k: 'c', n: 0 });
        return;
      }
      case 'eval': {
        const a = this.eval(s.value!);
        if (a.k === 'v' && hasEffect(this.tx.st, a.id)) this.emit(block, { op: 'eval', value: this.use(a.id) }, s);
        return;
      }
      default:
        throw new TxError('unsupported', `peval: statement "${s.op}" is outside the supported domain (${sid})`);
    }
  }

  /**
   * Trace one region from original block `start` under `sigma0`, emitting into residual block `into`. Ends at a
   * branch into an already-seen program point (the memo, or this region's own points, closes the loop), a dynamic
   * `br_if` (both arms cut), a `return`/`trap`, or a folded trap. `true` from `branch` means the region ended.
   */
  private branch(from: StmtRec, target: string, block: BlockRec): boolean {
    const key = keyOf(target, this.sigma, this.live.liveIn(target));
    if (this.memo.has(key)) {
      this.materialize(this.live.liveIn(target), block);
      this.emit(block, { op: 'br', to: this.memo.get(key)! }, from);
      return true;
    }
    if (this.visited.has(key)) {
      // a cycle closed inside this region: cut here; the pushed region is where the paths meet
      this.materialize(this.live.liveIn(target), block);
      this.emit(block, { op: 'br', to: this.enter(target) }, from);
      return true;
    }
    this.visited.add(key);
    return false;
  }

  region(start: string, sigma0: Sigma, into: string): void {
    const block = this.tx.st.get(into) as BlockRec;
    this.used = new Set();
    this.visited = new Set();
    this.sigma = copySigma(sigma0);
    this.regions.push({ block: start, residual: into, statements: 0, folds: 0, note: 'traced' });
    const info = this.regions.at(-1)!;
    const mark = this.stmts;
    let cur = start;
    for (;;) {
      if (++this.traced > PEVAL_LIMITS.maxBlocks) throw new PELimit('too many traced blocks');
      const B = this.src.get(cur) as BlockRec;
      if (!B || !B.stmts.length) throw new TxError('unsupported', `peval: block ${cur} has no terminator`);
      const last = this.src.get(B.stmts.at(-1)!) as StmtRec;
      try {
        for (const sid of B.stmts.slice(0, -1)) this.stmt(sid, block);
        if (last.op === 'trap') {
          this.emit(block, { op: 'trap', ...(last.why ? { why: last.why } : {}) }, last);
          return;
        }
        if (last.op === 'return') {
          const a = last.value ? this.eval(last.value) : undefined;
          if (a?.k === 'a') throw new TxError('unsupported', `peval: ${last.id} returns an address`);
          this.emit(
            block,
            {
              op: 'return',
              ...(a
                ? a.k === 'c'
                  ? { value: this.tx.const(a.n, this.opt(last.value!, 'the returned value is constant here')) }
                  : { value: this.use(a.id) }
                : {}),
            },
            last,
          );
          return;
        }
        if (last.op === 'br') {
          if (this.branch(last, last.to!, block)) return;
          cur = last.to!;
          continue;
        }
        if (last.op === 'br_if') {
          const c = this.eval(last.cond!);
          if (c.k === 'c') {
            this.folds++;
            const to = c.n ? last.then! : last.else!;
            if (this.branch(last, to, block)) return;
            cur = to;
            continue;
          }
          this.materialize(new Set([...this.live.liveIn(last.then!), ...this.live.liveIn(last.else!)]), block);
          if (c.k === 'a')
            throw new TxError('unsupported', `peval: ${last.id} branches on an address value`);
          const cond = this.use(c.id);
          const thenB = this.enter(last.then!);
          const elseB = this.enter(last.else!);
          this.emit(block, { op: 'br_if', cond, then: thenB, else: elseB }, last);
          return;
        }
        throw new TxError('unsupported', `peval: statement "${last.op}" is outside the supported domain`);
      } catch (e) {
        if (!(e instanceof TrapSignal)) throw e;
        this.emit(block, { op: 'trap', why: `the checked address traps (${e.at})` }, last);
        return;
      } finally {
        info.statements = this.stmts - mark;
        info.folds = this.folds;
      }
    }
  }
}

/** The values an input spec's `oneOf` allows, or null when it does not pin a small integer domain. */
function oneOf(spec: unknown): number[] | null {
  if (!spec || typeof spec !== 'object' || !Array.isArray((spec as { oneOf?: unknown }).oneOf)) return null;
  const values = (spec as { oneOf: unknown[] }).oneOf;
  if (!values.length || values.length > PEVAL_LIMITS.maxSplits || !values.every(v => Number.isInteger(v)))
    return null;
  return values.map(v => (v as number) | 0);
}

/** What `peval` did to one function, for the report. */
interface FnResult {
  readonly regions: readonly PEvalRegion[];
  readonly note: string;
}

/**
 * Trace `f` on its promises and replace its blocks with the residual. Throws `TxError`/`PELimit` to skip the
 * function unchanged. The entry: with a split parameter (an `oneOf` input spec), a `br_if` chain over the promised
 * values and a `trap` for everything else; otherwise one arm straight from the entry block.
 */
function pevalFunction(
  tx: Tx,
  src: Store,
  f: WorkFn,
  live: DataflowResult,
  buffers: readonly Binding[],
  scalars: readonly Binding[],
  inputs: ProgramInputs | undefined,
  because: readonly string[],
): FnResult {
  const liveViewOf = liveView(live, src, f.name);
  const mem = new Map<number, readonly number[]>();
  for (const b of buffers)
    mem.set(checkBufferBinding(src, f.name, f.locals, b.param!).index, (b as { cells: readonly number[] }).cells);
  const consts = new Map<number, number>();
  for (const b of scalars) {
    const i = f.locals.findIndex(l => l.param && l.name === b.param);
    if (i < 0) throw new TxError('unknownLocal', `${f.name} has no parameter "${b.param}"`);
    consts.set(i, b.value!);
  }
  // the split parameter: the first scalar parameter with a oneOf spec (the domain the contract generates from)
  const spec = inputs?.[f.name] ?? {};
  let splitIndex = -1,
    splitValues: number[] | null = null;
  f.locals.forEach((l, i) => {
    if (splitIndex >= 0 || !l.param || consts.has(i)) return;
    const values = oneOf(spec[l.name]);
    if (values) {
      splitIndex = i;
      splitValues = values;
    }
  });
  if (!mem.size && splitIndex < 0 && !consts.size)
    throw new TxError('unsupported', `${f.name}: nothing to specialize on`);

  const entry = f.blocks[0];
  const tracer = new Tracer(tx, src, f, liveViewOf, mem, because);
  const arm = (v: number | null): { sigma: Sigma; into: string } => {
    const into = tx.block({
      from: entry.id,
      because,
      note:
        v === null
          ? `specialized from the entry of ${f.name}`
          : `specialized for ${f.locals[splitIndex].name} = ${v}`,
    });
    const sigma: Sigma = {
      loc: f.locals.map((l, i) =>
        consts.has(i) ? { k: 'c', n: consts.get(i)! } : l.param ? { k: 'd' as const } : { k: 'c' as const, n: 0 },
      ),
      cell: new Map(),
    };
    if (v !== null) sigma.loc[splitIndex] = { k: 'c', n: v };
    return { sigma, into };
  };

  if (splitIndex >= 0) {
    // the entry dispatch: br_if (param == v) per promised value, else trap (the contract never leaves the domain)
    const name = f.locals[splitIndex].name;
    const values = splitValues!;
    let chain = tx.block({ from: entry.id, because, note: `the entry dispatch on the promised ${name}` });
    values.forEach((v, i) => {
      const a = arm(v);
      const cond = tx.make(
        'eq',
        tx.get(splitIndex, { from: entry.id, because, note: `the promised ${name} values` }),
        tx.const(v, { from: entry.id, because, note: `a promised value of ${name}` }),
        { from: entry.id, because, note: `${name} is one of the promised values` },
      );
      const last = i === values.length - 1;
      const next = last
        ? tx.block({ from: entry.id, because, note: 'outside the promised domain' })
        : tx.block({ from: entry.id, because, note: `the entry dispatch on the promised ${name}` });
      tx.insert(
        tx.at.end(tx.st.get(chain) as BlockRec),
        tx.stmt({ op: 'br_if', cond, then: a.into, else: next }, { from: entry.id, because, note: `the host promised ${name} = ${v}` }),
        { because, note: `the host promised ${name} = ${v}` },
      );
      if (last)
        tx.insert(
          tx.at.end(tx.st.get(next) as BlockRec),
          tx.stmt(
            {
              op: 'trap',
              why: `${f.name} was specialized for the promised values of ${name}; this ${name} is outside them`,
            },
            { from: entry.id, because, note: 'no meaning outside the promise' },
          ),
          { because, note: 'outside the promised domain' },
        );
      tracer.work.push({ block: entry.id, sigma: a.sigma, into: a.into });
      chain = next;
    });
  } else {
    const a = arm(null);
    tracer.work.push({ block: entry.id, sigma: a.sigma, into: a.into });
  }

  while (tracer.work.length) {
    const w = tracer.work.shift()!;
    tracer.region(w.block, w.sigma, w.into);
  }
  if (!tracer.folds) throw new PELimit('nothing folded: the residual would be the original function');

  // the original statements go, each citing the promise; then the original blocks leave the function
  for (const ob of src.fn(f.name).blocks)
    for (const sid of ob.stmts.slice())
      tx.remove(sid, { because: [...because], note: `folded into the specialized ${f.name}` });
  const originals = new Set(src.fn(f.name).blocks.map(b => b.id));
  const kept = f.blocks.filter(b => !originals.has(b.id));
  f.blocks.length = 0;
  f.blocks.push(...kept);
  tx.commit();
  return {
    regions: tracer.regions,
    note: `${tracer.regions.length} regions, ${tracer.folds} folds, ${tracer.cellLocals.size} frame cells in locals`,
  };
}

/**
 * Built by `makePeval(correspond)`, which passes.ts calls with its correspondence function, so this module
 * imports nothing from passes.ts at load time (the same pattern as `makeInline`).
 */
export function makePeval(
  correspond: (before: TypedBlocks, after: TypedBlocks, edits: readonly Edit[]) => CorrespondenceEntry[],
): TypedPass {
  const definition = definePass<TypedBlocks, Record<string, any>, Record<string, unknown>>({
    id: 'typed.peval',
    version: '1',
    description: ABOUT,
    ir: BlocksIR,
    adapter: blocksAdapter,
    needs: { live: ANALYSES.liveness },
    writes: {
      entities: ['local', 'block', 'stmt.*', 'value.*'],
      relations: ['declares', 'contains', 'uses', 'operand', 'reads', 'writes', 'succ', 'jump'],
    },
    preserves: [],
    run({ before, facts, params }) {
      const p = (params ?? {}) as PEvalParams;
      const bindings = p.bindings;
      if (!bindings || bindings.kind !== 'typed.bindings')
        throw new TxError('unsupported', 'peval needs params.bindings: a typed.bindings artifact');
      const src = Store.from(before.value),
        st = Store.from(before.value);
      const live = facts.live as DataflowResult;
      const rev = before.value.rev + 1;
      const edits: Edit[] = [],
        touched: string[] = [],
        skipped: { fn: string; reason: string }[] = [],
        detail: { fn: string; regions: readonly PEvalRegion[]; note: string }[] = [];
      for (const f of st.fns.values()) {
        const list = bindings.value.bindings.filter(
          (b: Binding) => b.fn === f.name && (isBufferBinding(b) || b.value !== undefined),
        );
        if (!list.length) continue;
        const blocks0 = f.blocks.slice(),
          locals0 = f.locals.length;
        try {
          const because = list.map(b => factRef(bindings, b));
          const tx = new Tx(st, f, { name: 'peval', writes: ['stmts', 'values', 'locals', 'cfg'] }, rev);
          const result = pevalFunction(tx, src, f, live, list.filter(isBufferBinding), list.filter(b => b.value !== undefined), p.inputs, because);
          touched.push(f.name);
          detail.push({ fn: f.name, regions: result.regions, note: result.note });
          edits.push(...tx.edits);
        } catch (e) {
          // restore the working copy: the new blocks and locals are unreachable and dropped at `toNative`
          f.blocks.length = 0;
          f.blocks.push(...blocks0);
          f.locals.length = locals0;
          if (e instanceof PELimit || (e instanceof TxError && e.code === 'unsupported')) {
            skipped.push({ fn: f.name, reason: (e as Error).message });
            continue;
          }
          throw e;
        }
      }
      if (!touched.length) {
        // nothing specialized: refuse with the reasons, as dfe refuses without its roots
        const reasons = skipped.map(s => `${s.fn}: ${s.reason}`).join('; ');
        throw new TxError(
          'unsupported',
          `peval: no function could be specialized${reasons ? ` (${reasons})` : ''}`,
        );
      }
      st.rev = rev;
      const native = st.toNative();
      const kinds = edits.reduce<Record<string, number>>((m, e) => ((m[e.kind] = (m[e.kind] || 0) + 1), m), {});
      const report: RevisionReport & { peval?: unknown; skipped?: unknown } = {
        pass: 'peval',
        rev,
        edits,
        fns: touched,
        kinds,
        peval: detail,
        ...(skipped.length ? { skipped } : {}),
      };
      return {
        native,
        correspondence: correspond(before.value, native, edits),
        edits: edits.length,
        report,
      };
    },
  });
  return Object.freeze({
    ...definition,
    typed: {
      name: 'peval',
      about: ABOUT,
      writes: ['stmts', 'values', 'locals', 'cfg'],
      program: true,
      body: () => {
        throw new TxError('unsupported', 'peval works on the whole program');
      },
    },
  }) as TypedPass;
}
