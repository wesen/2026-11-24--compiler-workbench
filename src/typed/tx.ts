/**
 * Transactions over the working store: the only way a typed pass changes a program (Compiler Workbench's Tx),
 * and read-only value handles for pass code.
 *
 * Every entity a transaction makes records its origin: the entity it was made from, the pass, the revision, and
 * `because` (the facts or entities that make the change valid). Every change is an edit record. A transaction
 * enforces the pass's declared write kinds (values, stmts, locals, cfg) with `undeclaredWrite`, removal needs a
 * `because`, and `commit` derives successors from terminators and drops unreachable blocks. The framework then
 * checks the coarser entity-kind declaration, the contract, and preservation claims on the resulting revision.
 */
import { prune } from './lift.js';
import { describeText, show, showStmt, COMPARE } from './listing.js';
import { hasEffect, isPure, readsOf } from './analyses.js';
import { F32_RESULT } from './f32.js';
import type { DerivationBy, DerivationStep } from '../framework/ir/derivation.js';
import {
  typeClass,
  type BlockRec,
  type Origin,
  type StmtRec,
  type Store,
  type TypeClass,
  type ValueOp,
  type ValueRec,
  type WorkFn,
} from './model.js';

/** `frame`: the function record's frame array area (`arrayBytes`), IRWB-036-F. */
export type WriteKind = 'values' | 'stmts' | 'locals' | 'cfg' | 'frame';
export const WRITE_KINDS: readonly WriteKind[] = ['values', 'stmts', 'locals', 'cfg', 'frame'];

export class TxError extends Error {
  constructor(
    readonly code:
      | 'undeclaredWrite'
      | 'missingBecause'
      | 'absent'
      | 'badPosition'
      | 'unknownLocal'
      | 'unsupported',
    message: string,
    readonly fix?: string,
  ) {
    super(`[${code}] ${message}${fix ? `\n  fix: ${fix}` : ''}`);
    this.name = 'TxError';
  }
}

export interface Edit {
  readonly id: string;
  readonly rev: number;
  readonly pass: string;
  readonly fn: string;
  readonly kind: string;
  /** IRWB-056-B: the derivation steps that licensed this edit (indices into the application's step list). */
  readonly steps?: readonly number[];
  readonly [field: string]: unknown;
}

type Ref = string | { readonly id: string };
export interface MakeOptions {
  readonly from?: Ref | null;
  readonly because?: readonly (Ref | string)[];
  readonly note?: string;
  readonly imm?: number | string;
  /**
   * The result type of a made value. Derived for get (the local's) and the f32 operators; needed for a constant,
   * a load or a result leaf of an f32 (absent: i32).
   */
  readonly type?: TypeClass;
}
export interface Position {
  readonly block: BlockRec;
  readonly index: number;
}

const TERMINATORS = new Set(['br', 'br_if', 'return', 'trap']);
const id = (x: Ref | null | undefined): string | undefined =>
  x === null || x === undefined ? undefined : typeof x === 'string' ? x : x.id;

// ---------- value handles ----------
export interface ValueHandle {
  readonly id: string;
  readonly op: ValueOp;
  readonly imm: number | string | undefined;
  readonly args: ValueHandle[];
  readonly isConst: boolean;
  readonly isLeaf: boolean;
  readonly isPure: boolean;
  readonly hasEffect: boolean;
  readonly isBoolean: boolean;
  /** The statement holding this value (given by the traversal, else looked up). */
  readonly statement: string | null;
  readonly text: string;
  same(other: Ref): boolean;
  size(): number;
}

const sameTree = (st: Store, a: string, b: string): boolean => {
  const x = st.get(a) as ValueRec,
    y = st.get(b) as ValueRec;
  return (
    x.op === y.op &&
    x.imm === y.imm &&
    x.type === y.type &&
    x.args.length === y.args.length &&
    x.args.every((u, i) => sameTree(st, u, y.args[i]))
  );
};

/** Which statement holds each live value (values have one user). */
export function statementOf(st: Store, value: string): string | null {
  for (const f of st.fns.values())
    for (const b of f.blocks)
      for (const sid of b.stmts) {
        const s = st.get(sid) as StmtRec;
        const walk = (v: string | undefined): boolean =>
          !!v && (v === value || (st.get(v) as ValueRec).args.some(walk));
        if (walk(s.value) || walk(s.cond) || walk(s.addr)) return sid;
      }
  return null;
}

export function valueHandle(st: Store, vid: string, ctx: { stmt?: string } = {}): ValueHandle {
  const e = st.get(vid) as ValueRec | undefined;
  if (!e || e.kind !== 'value') throw new TxError('absent', `${vid} is not a value of ${st.program}`);
  return {
    id: vid,
    op: e.op,
    imm: e.imm,
    get args() {
      return e.args.map(a => valueHandle(st, a, ctx));
    },
    get isConst() {
      return e.op === 'const';
    },
    get isLeaf() {
      return !e.args.length;
    },
    get isPure() {
      return isPure(st, vid);
    },
    get hasEffect() {
      return hasEffect(st, vid);
    },
    get isBoolean() {
      return COMPARE.has(e.op);
    },
    get statement() {
      return ctx.stmt ?? statementOf(st, vid);
    },
    get text() {
      return describeText(st, vid);
    },
    same: other => sameTree(st, vid, id(other)!),
    size() {
      const n = (x: string): number => 1 + (st.get(x) as ValueRec).args.reduce((s, a) => s + n(a), 0);
      return n(vid);
    },
  };
}

// ---------- transactions ----------
export interface PassInfo {
  readonly name: string;
  readonly writes: readonly WriteKind[];
}

/** The rule a `Tx.rewrite` visitor is applying, and the premises it relies on (rules/compile.ts). */
export interface ActiveRule {
  readonly by: DerivationBy;
  readonly premises: readonly string[];
  /** The site the rule matched: the matched node and its operands (the entities it read to produce its result). */
  readonly site?: readonly string[];
  readonly note?: string;
}

export class Tx {
  readonly edits: Edit[] = [];
  readonly writes: ReadonlySet<WriteKind>;
  private cur: string | null = null;
  private sid: string | null = null;
  private rule: ActiveRule | null = null;
  /** The step indices of the statement field being walked: what a `replace` record cites. */
  private pending: number[] = [];
  constructor(
    readonly st: Store,
    readonly fn: WorkFn,
    readonly pass: PassInfo,
    readonly rev: number,
    /** The pass's derivation steps, shared by the functions a pass walks in one application. */
    readonly steps: DerivationStep[] = [],
  ) {
    this.writes = new Set(pass.writes);
  }

  /** Run `f` with `rule` as the rule licensing every entity it makes and every edit it records. */
  withRule<A>(rule: ActiveRule, f: () => A): A {
    const outer = this.rule;
    this.rule = rule;
    try {
      return f();
    } finally {
      this.rule = outer;
    }
  }
  /**
   * The step for the entities a transaction made. `by` is the rule being applied (with the guards it checked) or the
   * decision that made them (`make`, `rebuild`, `set`, `local`, `block`…).
   */
  private made(produced: string, from: string | undefined | null, opts: MakeOptions, decision: string): void {
    const premises = [...(this.rule?.premises ?? []), ...(opts.because ?? []).map(b => id(b as Ref)!)].filter(
      (p, i, all) => all.indexOf(p) === i,
    );
    const note = opts.note ?? this.rule?.note;
    // the antecedent first, then the rest of the site the rule read
    const froms = [...new Set([...(from ? [from] : []), ...(this.rule?.site ?? [])])];
    this.steps.push({
      by: this.rule?.by ?? { decision },
      consumes: [...new Set(froms)],
      produces: [produced],
      premises: [...new Set(premises)].sort(),
      relation: froms.length ? 'modified' : 'inserted',
      ...(note ? { note } : {}),
    });
    this.pending.push(this.steps.length - 1);
  }
  /**
   * The step for a rule that created no entity: it produced one of the entities it consumed again (`x + 0` becomes
   * `x`). Its site is the tree it matched and the entity it produced, so the derivation records the rewrite even
   * though the correspondence, which is about survival, needs no entry for it.
   */
  inPlace(rule: ActiveRule, consumed: readonly string[], produced: string): void {
    this.steps.push({
      by: rule.by,
      consumes: [...new Set(consumed)],
      produces: [produced],
      premises: [...new Set(rule.premises)].sort(),
      relation: 'modified',
      ...(rule.note ? { note: rule.note } : {}),
    });
    this.pending.push(this.steps.length - 1);
  }
  /**
   * The step for an edit that is not about an entity this transaction made: the statement or block it is about, and
   * what it became. A removal's site is the source entity alone (and its block), so it is `removed`
   * (`edit-classes`'s "dead statement", the correspondence's `removed` entry with its reason).
   */
  private editStep(kind: string, detail: Record<string, unknown>): void {
    const one = (x: unknown): string[] => (typeof x === 'string' && x.length > 0 ? [x] : []);
    const side: Record<string, { consumes: string[]; produces: string[] }> = {
      remove: { consumes: [...one(detail.stmt), ...one(detail.block)], produces: [] },
      unreachable: { consumes: one(detail.block), produces: [] },
      // a moved or retargeted statement stays the same entity: it neither appears nor disappears, and the block it
      // points to is not something the step made
      move: { consumes: one(detail.stmt), produces: one(detail.stmt) },
      retarget: { consumes: one(detail.stmt), produces: one(detail.stmt) },
      replace: { consumes: one(detail.from), produces: one(detail.to) },
      replaceStmt: { consumes: one(detail.from), produces: one(detail.to) },
      merge: { consumes: one(detail.block), produces: one(detail.block) },
      insert: { consumes: [], produces: one(detail.stmt) },
    };
    const { consumes, produces } = side[kind] ?? {
      consumes: one(detail.local ?? detail.block ?? detail.stmt),
      produces: one(detail.local ?? detail.block ?? detail.stmt),
    };
    // a dropped block's reason is its unreachability, not an entity or a fact: the correspondence of a block that
    // is gone carries no reason, and an entry is the same whether the fill or a step gave it
    const premises =
      kind === 'unreachable'
        ? []
        : ((detail.because as unknown[]) ?? []).filter((p): p is string => typeof p === 'string');
    this.steps.push({
      by: { decision: kind },
      consumes: [...new Set(consumes)],
      produces: [...new Set(produces)],
      premises: [...new Set(premises)].sort(),
      relation:
        kind === 'remove' || kind === 'unreachable'
          ? 'removed'
          : consumes.length && produces.length
            ? 'modified'
            : produces.length
              ? 'inserted'
              : 'retained',
      ...(typeof detail.note === 'string' ? { note: detail.note } : {}),
    });
    this.pending.push(this.steps.length - 1);
  }

  private may(kind: WriteKind, what: string): void {
    if (!this.writes.has(kind))
      throw new TxError(
        'undeclaredWrite',
        `pass "${this.pass.name}" ${what} (it changes ${kind}) but declares writes(${[...this.writes].map(k => `'${k}'`).join(', ')}).`,
        `.writes(${[...this.writes, kind].map(k => `'${k}'`).join(', ')})`,
      );
  }
  private origin(from: string | undefined | null, opts: MakeOptions = {}): Origin[] {
    return [
      {
        from: from ?? '',
        via: this.pass.name,
        kind: 'recorded',
        rev: this.rev,
        because: (opts.because ?? []).map(b => id(b as Ref)!),
        ...(opts.note ? { note: opts.note } : {}),
      },
    ];
  }
  private because(opts: MakeOptions): string[] {
    return (opts.because ?? []).map(b => id(b as Ref)!);
  }
  /** Kinds that are their own reason: the statement or block they are about is the step's site. */
  private static readonly OWN: ReadonlySet<string> = new Set([
    'remove',
    'unreachable',
    'move',
    'retarget',
    'merge',
    'note',
    'insert',
  ]);

  record(kind: string, detail: Record<string, unknown>): Edit {
    // a `replace` records the value rewrite the current field's walk made: its steps are the ones it just pushed; a
    // `local`/`block` edit cites the step that made the entity. A structural edit is its own step.
    const own = Tx.OWN.has(kind);
    const cited = !own && this.pending.length ? [...this.pending] : null;
    if (!cited) this.editStep(kind, detail);
    const e: Edit = {
      id: `edit:r${this.rev}.${this.edits.length}`,
      rev: this.rev,
      pass: this.pass.name,
      fn: this.fn.name,
      kind,
      ...detail,
      ...(cited ? { steps: [...this.pending] } : { steps: [this.steps.length - 1] }),
    };
    this.pending = [];
    this.edits.push(e);
    return e;
  }

  // values
  /** A constant; an f32 constant (`type: 'f32'`) is given as its bits. */
  const(n: number, opts: MakeOptions = {}): string {
    this.may('values', 'made a constant');
    const vid = this.st.add<ValueRec>({
      id: this.st.fresh(`v:${this.fn.name}`),
      kind: 'value',
      fn: this.fn.id,
      op: 'const',
      args: [],
      ...(opts.type === 'f32' ? { type: 'f32' as const } : {}),
      imm: n | 0,
      origin: this.origin(id(opts.from) ?? this.cur, opts),
    }).id;
    this.made(vid, id(opts.from) ?? this.cur, opts, 'make');
    return vid;
  }
  /** The type a made value has: given, or the local's for a get, or f32 for the f32 operators. */
  private typeOf(op: ValueOp, opts: MakeOptions): TypeClass {
    if (opts.type) return opts.type;
    if (op === 'get') return typeClass(this.fn.locals[opts.imm as number]?.type);
    return F32_RESULT.has(op) ? 'f32' : 'i32';
  }
  make(op: ValueOp, ...rest: (Ref | MakeOptions)[]): string {
    this.may('values', 'made a value');
    const last = rest.at(-1) as MakeOptions | Ref | undefined;
    const opts: MakeOptions =
      rest.length && typeof last === 'object' && last && !(last as { id?: string }).id && !Array.isArray(last)
        ? (rest.pop() as MakeOptions)
        : {};
    const rec: ValueRec = {
      id: this.st.fresh(`v:${this.fn.name}`),
      kind: 'value',
      fn: this.fn.id,
      op,
      args: (rest as Ref[]).map(a => id(a)!),
      origin: this.origin(id(opts.from) ?? this.cur, opts),
    };
    if (this.typeOf(op, opts) === 'f32') rec.type = 'f32';
    if (opts.imm !== undefined) rec.imm = opts.imm;
    const vid = this.st.add(rec).id;
    this.made(vid, id(opts.from) ?? this.cur, opts, 'make');
    return vid;
  }
  get(local: number | string | { index: number }, opts: MakeOptions = {}): string {
    return this.make('get', { imm: this.local_(local), ...opts });
  }
  private local_(l: number | string | { index: number }): number {
    if (typeof l === 'number') return l;
    if (typeof l === 'string') {
      const i = this.fn.locals.findIndex(x => x.name === l);
      if (i < 0) throw new TxError('unknownLocal', `${this.fn.name} has no local "${l}"`);
      return i;
    }
    return l.index;
  }
  local(name: string, opts: MakeOptions = {}): number {
    this.may('locals', 'made a local');
    let n = name,
      k = 1;
    while (this.fn.locals.some(l => l.name === n)) n = name + k++;
    const index = this.fn.locals.length;
    this.fn.locals.push({
      index,
      name: n,
      type: opts.type || 'i32',
      param: false,
      mutable: true,
      madeBy: this.pass.name,
      rev: this.rev,
    });
    this.record('local', { local: `local:${this.fn.name}/${n}`, name: n, because: this.because(opts) });
    return index;
  }

  // statements
  set(local: number | string, value: Ref, opts: MakeOptions = {}): string {
    this.may('stmts', 'made a statement');
    const sid = this.st.add<StmtRec>({
      id: this.st.fresh(`s:${this.fn.name}`),
      kind: 'stmt',
      fn: this.fn.id,
      op: 'set',
      local: this.local_(local),
      value: id(value),
      origin: this.origin(id(opts.from) ?? id(value), opts),
    }).id;
    this.made(sid, id(opts.from) ?? id(value), opts, 'set');
    return sid;
  }
  stmt(fields: Partial<StmtRec> & { op: StmtRec['op'] }, opts: MakeOptions = {}): string {
    this.may('stmts', 'made a statement');
    const sid = this.st.add({
      id: this.st.fresh(`s:${this.fn.name}`),
      kind: 'stmt',
      fn: this.fn.id,
      ...fields,
      origin: this.origin(id(opts.from), opts),
    } as StmtRec).id;
    this.made(sid, id(opts.from), opts, 'stmt');
    return sid;
  }
  blockOf(sid: string): BlockRec | undefined {
    return this.fn.blocks.find(b => b.stmts.includes(sid));
  }
  insert(position: Position, stmt: Ref, opts: MakeOptions = {}): string {
    this.may('stmts', 'inserted a statement');
    const sid = id(stmt)!;
    const { block, index } = this.pos(position);
    block.stmts.splice(index, 0, sid);
    this.record('insert', { stmt: sid, block: block.id, at: index, because: this.because(opts) });
    return sid;
  }
  private pos(position: Position | undefined): Position {
    if (position && position.block && position.index !== undefined) return position;
    throw new TxError(
      'badPosition',
      'insert needs a position: tx.at.end(block), tx.at.before(stmt) or tx.at.after(stmt)',
    );
  }
  get at() {
    const self = this;
    return {
      end(block: Ref): Position {
        const b = self.st.get(id(block)!) as BlockRec;
        const last = b.stmts.length && (self.st.get(b.stmts.at(-1)!) as StmtRec);
        const term = last && TERMINATORS.has(last.op);
        return { block: b, index: b.stmts.length - (term ? 1 : 0) };
      },
      start(block: Ref): Position {
        return { block: self.st.get(id(block)!) as BlockRec, index: 0 };
      },
      before(stmt: Ref): Position {
        const sid = id(stmt)!,
          b = self.blockOf(sid)!;
        return { block: b, index: b.stmts.indexOf(sid) };
      },
      after(stmt: Ref): Position {
        const sid = id(stmt)!,
          b = self.blockOf(sid)!;
        return { block: b, index: b.stmts.indexOf(sid) + 1 };
      },
    };
  }
  remove(stmt: Ref, opts: MakeOptions = {}): void {
    this.may('stmts', 'removed a statement');
    const sid = id(stmt)!;
    if (!opts.because || !opts.because.length)
      throw new TxError(
        'missingBecause',
        `tx.remove(${sid}) needs { because: [...] }: the facts or entities that make the removal valid`,
      );
    const b = this.blockOf(sid);
    if (!b) throw new TxError('absent', `${sid} is not in ${this.fn.name} at this revision`);
    b.stmts.splice(b.stmts.indexOf(sid), 1);
    this.record('remove', {
      stmt: sid,
      block: b.id,
      text: showStmt(this.st, sid),
      because: this.because(opts),
      ...(opts.note ? { note: opts.note } : {}),
    });
  }
  move(stmt: Ref, position: Position, opts: MakeOptions = {}): void {
    this.may('stmts', 'moved a statement');
    const sid = id(stmt)!,
      b = this.blockOf(sid)!;
    b.stmts.splice(b.stmts.indexOf(sid), 1);
    const { block, index } = this.pos(position);
    block.stmts.splice(index, 0, sid);
    this.record('move', { stmt: sid, from: b.id, to: block.id, because: this.because(opts) });
  }
  /** Replace one statement's value field (value, cond, addr) or branch target (to, then, else). */
  setField(
    stmt: Ref,
    field: 'value' | 'cond' | 'addr' | 'to' | 'then' | 'else',
    value: Ref,
    opts: MakeOptions = {},
  ): void {
    const s = this.st.get(id(stmt)!) as StmtRec;
    if (field === 'value' || field === 'cond' || field === 'addr') this.may('values', 'changed a value');
    else this.may('cfg', 'changed a branch');
    const from = s[field];
    s[field] = id(value);
    this.record(field === 'to' || field === 'then' || field === 'else' ? 'retarget' : 'replace', {
      stmt: s.id,
      field,
      from,
      to: s[field],
      because: this.because(opts),
    });
  }
  replaceStmt(old: Ref, fields: Partial<StmtRec> & { op: StmtRec['op'] }, opts: MakeOptions = {}): string {
    this.may('stmts', 'replaced a statement');
    if (fields.op === 'br' || fields.op === 'br_if') this.may('cfg', 'changed a branch');
    const oid = id(old)!,
      b = this.blockOf(oid)!;
    const nid = this.stmt(fields, { from: oid, ...opts });
    b.stmts[b.stmts.indexOf(oid)] = nid;
    this.record('replaceStmt', {
      from: oid,
      to: nid,
      block: b.id,
      text: showStmt(this.st, nid),
      because: this.because(opts),
    });
    return nid;
  }
  block(opts: MakeOptions = {}): string {
    this.may('cfg', 'made a block');
    const b: BlockRec = {
      id: this.st.fresh(`bb:${this.fn.name}`).replace(/\.(\d+)$/, (_m, n) => '.n' + n),
      kind: 'block',
      fn: this.fn.id,
      stmts: [],
      succ: [],
      origin: this.origin(id(opts.from), opts),
    };
    this.st.add(b);
    this.fn.blocks.push(b);
    this.made(b.id, id(opts.from), opts, 'block');
    this.record('block', { block: b.id, because: this.because(opts) });
    return b.id;
  }
  /** Rebuild every live statement's trees bottom-up; visit(handle) returns a new value id or nothing. */
  rewrite(
    visit: (v: ValueHandle) => Ref | void | undefined,
    blocks: readonly BlockRec[] = this.fn.blocks,
    opts: MakeOptions = {},
  ): void {
    const walk = (vid: string): string => {
      const v = this.st.get(vid) as ValueRec;
      const args = v.args.map(walk);
      let cur = vid;
      if (args.some((a, i) => a !== v.args[i])) {
        this.may('values', 'rebuilt a value');
        const rec: ValueRec = {
          id: this.st.fresh(`v:${this.fn.name}`),
          kind: 'value',
          fn: this.fn.id,
          op: v.op,
          args,
          origin: this.origin(vid, { note: 'rebuilt around a changed argument' }),
        };
        if (v.type) rec.type = v.type;
        if (v.imm !== undefined) rec.imm = v.imm;
        cur = this.st.add(rec).id;
        this.made(cur, vid, { note: 'rebuilt around a changed argument' }, 'rebuild');
      }
      this.cur = cur;
      const r = visit(valueHandle(this.st, cur, { stmt: this.sid ?? undefined }));
      this.cur = null;
      return r ? id(r as Ref)! : cur;
    };
    for (const b of blocks)
      for (const sid of b.stmts.slice()) {
        const s = this.st.get(sid) as StmtRec;
        this.sid = sid;
        for (const k of ['value', 'cond', 'addr'] as const)
          if (s[k]) {
            const n = walk(s[k]!);
            if (n !== s[k]) {
              this.record('replace', {
                stmt: sid,
                field: k,
                from: s[k],
                to: n,
                text: show(this.st, n),
                because: this.because(opts),
              });
              s[k] = n;
            }
          }
      }
    // a value made before the walk (the `tx.get` handed to `tx.replace`) was cited by the first record it changed
    this.pending = [];
    this.sid = null;
  }
  /** Replace one value wherever it occurs (it has one user), rebuilding its parents. */
  replace(old: Ref, next: Ref, opts: MakeOptions = {}): string {
    const oid = id(old)!,
      nid = id(next)!;
    let found = false;
    this.rewrite(
      h => {
        if (h.id === oid) {
          found = true;
          return nid;
        }
      },
      this.fn.blocks,
      opts,
    );
    if (!found) throw new TxError('absent', `${oid} is not used in ${this.fn.name} at this revision`);
    return nid;
  }
  note(text: string): void {
    this.record('note', { text });
  }
  /** Derive successors from terminators, then drop unreachable blocks. */
  commit(): void {
    for (const b of this.fn.blocks) {
      const last = b.stmts.length ? (this.st.get(b.stmts.at(-1)!) as StmtRec) : null;
      const succ = !last
        ? b.succ
        : last.op === 'br'
          ? [last.to!]
          : last.op === 'br_if'
            ? [last.then!, last.else!]
            : last.op === 'return' || last.op === 'trap'
              ? []
              : b.succ;
      b.succ = [...new Set(succ)];
    }
    for (const b of prune(this.st, this.fn)) this.record('unreachable', { block: b.id, because: ['cfg'] });
  }
}

export { readsOf };
