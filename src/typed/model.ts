/**
 * The native representation of a lifted Typed program (`typed.blocks`), and the mutable working store passes use.
 *
 * Entities follow Compiler Workbench's model so its algorithms port directly:
 *   - a function `fn:NAME` has parameters, a result type, locals and an ordered list of blocks;
 *   - a block `bb:NAME.N` has an ordered list of statements and its successors;
 *   - a statement `s:NAME.N` is one of set, store, eval, br, br_if, return, trap, zero (array.zero);
 *   - a value `v:NAME.N` is a tree node (const, get, arithmetic, compare, load, call, …); a value has one user;
 *     its `type` is its result type: absent for i32 (every integer-like Typed type), 'f32' for an f32;
 *   - a front-end op `op:NAME#N` is one operation of the reused front end's tape, with its source position.
 * Every entity except an op carries `origin`: what it was made from, by which pass at which revision, and why that
 * was valid (`because`). Ids are allocated from counters stored in the artifact, so a pass run twice on the same
 * revision produces the same ids, and so the same revision hash.
 *
 * The native value (`TypedBlocks`) is finite JSON and keyed by id; only live entities are kept: statements in
 * blocks, values reachable from them, blocks in functions. The working `Store` resolves ids to records and mirrors
 * the prototype's in-memory shapes (a function's `blocks` are block records), and `toNative` writes it back.
 */

export type StmtOp = 'set' | 'store' | 'eval' | 'br' | 'br_if' | 'return' | 'trap' | 'zero';
/**
 * Value operators. The i32 operators are Compiler Workbench's. The f32 operators have their own names, so a rule
 * written for an i32 operator never matches an f32 one (`flt` is not `lt`: its negation is not `fge`, because of NaN).
 *   f32 → f32       fadd fsub fmul fdiv fmin fmax fcopysign (binary), fneg fabs fsqrt ffloor fceil ftrunc (unary)
 *   f32 → i32       feq fne flt fgt fle fge (0 or 1), f2i f2u (toward zero, saturating), f2bits (the IEEE bits)
 *   i32 → f32       i2f u2f (rounded to nearest even), bits2f (the f32 with these bits)
 *   addressing      caddr(receiver, position): traps unless position <u load32[receiver], else receiver + 2·position
 *                   aaddr (imm = byte offset): the address of a byte of the function's frame array area
 *   results         result (imm = k): leaf k of the record result of the latest multi-result call in this frame;
 *                   tuple(leaves…): a record result, only as the value of a `return`
 * `load` with `type: 'f32'` is f32.load (the same bits as an i32 load); `store` stores its value's bits.
 */
export type ValueOp =
  | 'const'
  | 'get'
  | 'add'
  | 'sub'
  | 'mul'
  | 'div'
  | 'rem'
  | 'and'
  | 'or'
  | 'xor'
  | 'shl'
  | 'shr'
  | 'shru'
  | 'eq'
  | 'ne'
  | 'lt'
  | 'gt'
  | 'le'
  | 'ge'
  | 'ltu'
  | 'geu'
  | 'eqz'
  | 'load'
  | 'load16u'
  | 'call'
  | 'fadd'
  | 'fsub'
  | 'fmul'
  | 'fdiv'
  | 'fmin'
  | 'fmax'
  | 'fcopysign'
  | 'fneg'
  | 'fabs'
  | 'fsqrt'
  | 'ffloor'
  | 'fceil'
  | 'ftrunc'
  | 'feq'
  | 'fne'
  | 'flt'
  | 'fgt'
  | 'fle'
  | 'fge'
  | 'f2i'
  | 'f2u'
  | 'f2bits'
  | 'i2f'
  | 'u2f'
  | 'bits2f'
  | 'caddr'
  | 'aaddr'
  | 'result'
  | 'tuple';

/** A value's type class: 'f32', or 'i32' for every other Typed type (absent in a value record). */
export type TypeClass = 'i32' | 'f32';
export const typeClass = (type: string | undefined): TypeClass => (type === 'f32' ? 'f32' : 'i32');

export interface SourcePos {
  readonly line: number;
  readonly col: number;
  readonly start?: number;
  readonly end?: number;
}

/** What an entity was made from (`from`), by what (`via`, `rev`), and why that is valid (`because`). */
export interface Origin {
  from: string;
  via: string;
  kind: 'recorded' | 'derived' | 'made';
  rev?: number;
  because?: string[];
  note?: string;
}

export interface LocalRec {
  index: number;
  name: string;
  type: string;
  param: boolean;
  mutable: boolean;
  temp?: string;
  at?: SourcePos | null;
  /** Set on locals a pass made (Compiler Workbench's tx.local). */
  madeBy?: string;
  rev?: number;
}

export interface FnRec {
  id: string;
  kind: 'function';
  name: string;
  params: string[];
  result: string;
  /** The leaf types of a value-record result (several results, Wasm multi-value); absent for one result. */
  results?: string[];
  /** The size in bytes of the function's frame array area (array.address, array.zero); absent when none. */
  arrayBytes?: number;
  locals: LocalRec[];
  origin: Origin[];
}

export interface BlockRec {
  id: string;
  kind: 'block';
  fn: string;
  stmts: string[];
  succ: string[];
  origin: Origin[];
}

export interface StmtRec {
  id: string;
  kind: 'stmt';
  fn: string;
  op: StmtOp;
  local?: number;
  value?: string;
  cond?: string;
  addr?: string;
  to?: string;
  then?: string;
  else?: string;
  width?: number;
  offset?: number;
  /** `zero`: the number of bytes of the frame array area to zero from `offset`. */
  bytes?: number;
  why?: string;
  origin: Origin[];
}

export interface ValueRec {
  id: string;
  kind: 'value';
  fn: string;
  op: ValueOp;
  args: string[];
  /** The value's result type; absent means i32. An f32 constant's `imm` is its IEEE bits as a signed i32. */
  type?: 'f32';
  imm?: number | string;
  origin: Origin[];
}

export interface OpRec {
  id: string;
  kind: 'op';
  fn: string;
  op: string;
  operands: number[];
  at: SourcePos | null;
}

export type Entity = FnRec | BlockRec | StmtRec | ValueRec | OpRec;

export interface FrontEndInfo {
  readonly wasmBytes: number;
  readonly records: unknown;
  readonly enums: unknown;
  readonly signatures: unknown;
}

/** The native, immutable value of one revision. */
export interface TypedBlocks {
  readonly formatVersion: 1;
  readonly program: string;
  /** Revision number: 0 at ingest, one more for each pass application that changed the program. */
  readonly rev: number;
  readonly counters: Readonly<Record<string, number>>;
  /** Function names in source order (the tables themselves are sorted by id). */
  readonly fnOrder: readonly string[];
  /** Function name -> function record plus the ordered ids of its blocks. */
  readonly fns: Readonly<Record<string, FnRec & { readonly blocks: readonly string[] }>>;
  readonly blocks: Readonly<Record<string, BlockRec>>;
  readonly stmts: Readonly<Record<string, StmtRec>>;
  readonly values: Readonly<Record<string, ValueRec>>;
  readonly ops: Readonly<Record<string, OpRec>>;
  readonly frontEnd: FrontEndInfo;
}

/** A function in the working store: its `blocks` are the block records themselves, in order. */
export interface WorkFn extends FnRec {
  blocks: BlockRec[];
}

const clone = <T>(x: T): T => structuredClone(x);

/** The mutable working copy a pass, the lifter or the backend operates on. */
export class Store {
  readonly ents = new Map<string, Entity>();
  readonly counters = new Map<string, number>();
  readonly fns = new Map<string, WorkFn>();
  rev = 0;
  constructor(
    readonly program: string,
    public frontEnd: FrontEndInfo = { wasmBytes: 0, records: null, enums: null, signatures: null },
  ) {}

  fresh(prefix: string): string {
    const n = this.counters.get(prefix) ?? 0;
    this.counters.set(prefix, n + 1);
    return `${prefix}.${n}`;
  }
  add<E extends Entity>(e: E): E {
    this.ents.set(e.id, e);
    return e;
  }
  get(id: string): any {
    return this.ents.get(id);
  }
  has(id: string): boolean {
    return this.ents.has(id);
  }
  fn(name: string): WorkFn {
    const f = this.fns.get(name);
    if (!f) throw new Error(`unknownFunction: ${this.program} has no function "${name}"`);
    return f;
  }

  /** A working copy of a native revision; records are cloned, so the artifact stays immutable. */
  static from(native: TypedBlocks): Store {
    const st = new Store(native.program, clone(native.frontEnd));
    st.rev = native.rev;
    for (const [k, v] of Object.entries(native.counters)) st.counters.set(k, v);
    for (const o of Object.values(native.ops)) st.add(clone(o));
    for (const v of Object.values(native.values)) st.add(clone(v));
    for (const s of Object.values(native.stmts)) st.add(clone(s));
    for (const b of Object.values(native.blocks)) st.add(clone(b));
    for (const name of native.fnOrder) {
      const { blocks, ...rest } = clone(native.fns[name]);
      const work: WorkFn = { ...(rest as FnRec), blocks: blocks.map(id => st.get(id) as BlockRec) };
      st.add(work);
      st.fns.set(name, work);
    }
    return st;
  }

  /** Live ids: blocks of functions, their statements, and values reachable from those statements. */
  liveIds(): Set<string> {
    const out = new Set<string>();
    const walk = (id: string | undefined) => {
      if (!id || out.has(id)) return;
      const v = this.get(id) as ValueRec | undefined;
      if (!v) return;
      out.add(id);
      for (const a of v.args ?? []) walk(a);
    };
    for (const f of this.fns.values())
      for (const b of f.blocks) {
        out.add(b.id);
        for (const s of b.stmts) {
          out.add(s);
          const e = this.get(s) as StmtRec;
          walk(e.value);
          walk(e.cond);
          walk(e.addr);
        }
      }
    return out;
  }

  /** The native value of the current state: only live entities, ids sorted for a canonical encoding. */
  toNative(): TypedBlocks {
    const live = this.liveIds();
    const fns: Record<string, FnRec & { blocks: string[] }> = {};
    const blocks: Record<string, BlockRec> = {},
      stmts: Record<string, StmtRec> = {},
      values: Record<string, ValueRec> = {},
      ops: Record<string, OpRec> = {};
    const sorted = <T>(m: Map<string, T>) => [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [name, f] of [...this.fns].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const { blocks: bs, ...rest } = f;
      fns[name] = { ...clone(rest), blocks: bs.map(b => b.id) };
    }
    for (const [id, e] of sorted(this.ents)) {
      if (e.kind === 'op') ops[id] = clone(e);
      else if (!live.has(id)) continue;
      else if (e.kind === 'block') blocks[id] = clone(e);
      else if (e.kind === 'stmt') stmts[id] = clone(e);
      else if (e.kind === 'value') values[id] = clone(e);
    }
    const counters = Object.fromEntries([...this.counters].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    return {
      formatVersion: 1,
      program: this.program,
      rev: this.rev,
      counters,
      fnOrder: [...this.fns.keys()],
      fns,
      blocks,
      stmts,
      values,
      ops,
      frontEnd: clone(this.frontEnd),
    };
  }
}
