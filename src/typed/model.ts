/**
 * The native representation of a lifted Typed program (`typed.blocks`), and the mutable working store passes use.
 *
 * Entities follow Compiler Workbench's model so its algorithms port directly:
 *   - a function `fn:NAME` has parameters, a result type, locals and an ordered list of blocks;
 *   - a block `bb:NAME.N` has an ordered list of statements and its successors;
 *   - a statement `s:NAME.N` is one of set, store, eval, br, br_if, return, trap;
 *   - a value `v:NAME.N` is a pure tree node (const, get, arithmetic, compare, load, call); a value has one user;
 *   - a front-end op `op:NAME#N` is one operation of the reused front end's tape, with its source position.
 * Every entity except an op carries `origin`: what it was made from, by which pass at which revision, and why that
 * was valid (`because`). Ids are allocated from counters stored in the artifact, so a pass run twice on the same
 * revision produces the same ids, and so the same revision hash.
 *
 * The native value (`TypedBlocks`) is finite JSON and keyed by id; only live entities are kept: statements in
 * blocks, values reachable from them, blocks in functions. The working `Store` resolves ids to records and mirrors
 * the prototype's in-memory shapes (a function's `blocks` are block records), and `toNative` writes it back.
 */

export type StmtOp = 'set' | 'store' | 'eval' | 'br' | 'br_if' | 'return' | 'trap';
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
  | 'call';

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
  why?: string;
  origin: Origin[];
}

export interface ValueRec {
  id: string;
  kind: 'value';
  fn: string;
  op: ValueOp;
  args: string[];
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
