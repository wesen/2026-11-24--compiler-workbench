/**
 * IRWB-004 F1: functions as the unit of change.
 *
 * A **function part** is a derived, frozen grouping of one function's records in one revision: its function record
 * and its blocks, statements, values and front-end operations (each list in id order). Parts are not part of the
 * canonical value and change no hash. Their one property that matters is identity stability: when every record of a
 * function in a new value is the same frozen object as in an earlier value, and the function has the same records,
 * `partsOf` returns the earlier part object. A pass that changed 3 functions therefore yields 329 parts that are the
 * very objects of the previous revision, and anything keyed on a part (its hash, its validation, the outcomes of its
 * cases) is reused for them.
 *
 *   partHash(part)       SHA-256 of a canonical encoding of the part's records, once per part object
 *   calleesOf(part)      the functions its `call` values name
 *   closureKey(value, f) a hash of every function reachable from f by calls (name and part hash) and of whether the
 *                        program has frame arrays: the inputs, besides the case and the step limit, on which the
 *                        evaluator's outcome for a case of f depends (see evaluate.ts: calls by name, and a stack
 *                        area above guest memory when any function has frame arrays)
 */
import { canonical, immutable, isCanonical } from '../framework/core/data.js';
import { sha256Parts } from '../framework/core/sha256.js';
import type { BlockRec, FnRec, OpRec, StmtRec, TypedBlocks, ValueRec } from './model.js';

export interface FunctionPart {
  readonly name: string;
  readonly fn: FnRec & { readonly blocks: readonly string[] };
  readonly blocks: readonly BlockRec[];
  readonly stmts: readonly StmtRec[];
  readonly values: readonly ValueRec[];
  readonly ops: readonly OpRec[];
}

const PARTS = new WeakMap<object, ReadonlyMap<string, FunctionPart>>();
/** The last part made for a (frozen) function record: the candidate a later value's function is compared with. */
const PART_OF_FN = new WeakMap<object, FunctionPart>();

const sameList = <T>(a: readonly T[], b: readonly T[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** The parts of a value, by function name, in `fnOrder`; cached per frozen value. */
export function partsOf(v: TypedBlocks): ReadonlyMap<string, FunctionPart> {
  const cached = PARTS.get(v);
  if (cached) return cached;
  type Group = { blocks: BlockRec[]; stmts: StmtRec[]; values: ValueRec[]; ops: OpRec[] };
  const groups = new Map<string, Group>();
  const group = (fnId: string) => {
    let g = groups.get(fnId);
    if (!g) groups.set(fnId, (g = { blocks: [], stmts: [], values: [], ops: [] }));
    return g;
  };
  // the tables of a canonical value enumerate in id order, so each list is in id order
  for (const b of Object.values(v.blocks)) group(b.fn).blocks.push(b);
  for (const s of Object.values(v.stmts)) group(s.fn).stmts.push(s);
  for (const x of Object.values(v.values)) group(x.fn).values.push(x);
  for (const o of Object.values(v.ops)) group(o.fn).ops.push(o);
  const out = new Map<string, FunctionPart>();
  const frozen = isCanonical(v);
  for (const name of v.fnOrder) {
    const fn = v.fns[name];
    const g = groups.get(fn.id) ?? { blocks: [], stmts: [], values: [], ops: [] };
    const prev = frozen ? PART_OF_FN.get(fn) : undefined;
    let part: FunctionPart;
    if (
      prev &&
      sameList(prev.blocks, g.blocks) &&
      sameList(prev.stmts, g.stmts) &&
      sameList(prev.values, g.values) &&
      sameList(prev.ops, g.ops)
    )
      part = prev;
    else {
      part = Object.freeze({
        name,
        fn,
        blocks: Object.freeze(g.blocks),
        stmts: Object.freeze(g.stmts),
        values: Object.freeze(g.values),
        ops: Object.freeze(g.ops),
      });
      if (frozen) PART_OF_FN.set(fn, part);
    }
    out.set(name, part);
  }
  if (frozen) PARTS.set(v, out);
  return out;
}

const TEXTS = new WeakMap<FunctionPart, string>();
/** A canonical encoding of a part's records: `[fn,[blocks],[stmts],[values],[ops]]`, from the records' texts. */
export function partText(p: FunctionPart): string {
  let t = TEXTS.get(p);
  if (t === undefined) {
    const list = (xs: readonly object[]) => '[' + xs.map(x => canonical(x)).join(',') + ']';
    t =
      '[' +
      canonical(p.fn) +
      ',' +
      list(p.blocks) +
      ',' +
      list(p.stmts) +
      ',' +
      list(p.values) +
      ',' +
      list(p.ops) +
      ']';
    TEXTS.set(p, t);
  }
  return t;
}

const HASHES = new WeakMap<FunctionPart, string>();
/** SHA-256 of `partText`, once per part object. */
export function partHash(p: FunctionPart): string {
  let h = HASHES.get(p);
  if (h === undefined) HASHES.set(p, (h = sha256Parts([partText(p)])));
  return h;
}

const CALLEES = new WeakMap<FunctionPart, readonly string[]>();
/** The functions a part's `call` values name, sorted. */
export function calleesOf(p: FunctionPart): readonly string[] {
  let c = CALLEES.get(p);
  if (!c) {
    const s = new Set<string>();
    for (const x of p.values) if (x.op === 'call') s.add(x.imm as string);
    CALLEES.set(p, (c = Object.freeze([...s].sort())));
  }
  return c;
}

/** Whether any function of the program has frame arrays (the evaluator then adds a stack area to guest memory). */
export function hasFrameArrays(v: TypedBlocks): boolean {
  return Object.values(v.fns).some(f => !!f.arrayBytes);
}

/** The functions reachable from `f` by calls, `f` included, sorted (a name the program does not define included). */
export function closureOf(v: TypedBlocks, f: string): readonly string[] {
  const parts = partsOf(v);
  const seen = new Set<string>(),
    todo = [f];
  while (todo.length) {
    const g = todo.pop()!;
    if (seen.has(g)) continue;
    seen.add(g);
    const p = parts.get(g);
    if (p) for (const c of calleesOf(p)) if (!seen.has(c)) todo.push(c);
  }
  return [...seen].sort();
}

// ---------- programs as parts, between threads (IRWB-004 F4) ----------

/**
 * A program named by its parts: per function (in `fnOrder`) the hash of its part, and, when `full`, the two
 * program-wide records that are not in any part (`counters`, `frontEnd`). A thread that holds the parts by hash can
 * rebuild the value from this (`assembleParts`); with `full`, the rebuilt value has the original's revision.
 */
export interface PartsRef {
  readonly revision: string;
  readonly program: string;
  readonly rev: number;
  readonly fnOrder: readonly string[];
  readonly hashes: readonly string[];
  readonly counters?: Readonly<Record<string, number>>;
  readonly frontEnd?: TypedBlocks['frontEnd'];
}
export function partsRef(revision: string, v: TypedBlocks, full = false): PartsRef {
  const parts = partsOf(v);
  return {
    revision,
    program: v.program,
    rev: v.rev,
    fnOrder: v.fnOrder,
    hashes: v.fnOrder.map(n => partHash(parts.get(n)!)),
    ...(full ? { counters: v.counters, frontEnd: v.frontEnd } : {}),
  };
}
/** A part's records as `partText` writes them: [fn, blocks, stmts, values, ops]. */
export type PartRecords = readonly [
  FnRec & { readonly blocks: readonly string[] },
  readonly BlockRec[],
  readonly StmtRec[],
  readonly ValueRec[],
  readonly OpRec[],
];
/** The records of a part text, frozen and canonical (as `immutable` makes them). */
export function parsePart(text: string): PartRecords {
  return immutable(JSON.parse(text)) as PartRecords;
}
/** The value a `PartsRef` names, from parts by hash; frozen. Without `counters`/`frontEnd`, they are empty. */
export function assembleParts(ref: PartsRef, part: (hash: string) => PartRecords | undefined): TypedBlocks {
  const fns: Record<string, unknown> = {},
    blocks: Record<string, BlockRec> = {},
    stmts: Record<string, StmtRec> = {},
    values: Record<string, ValueRec> = {},
    ops: Record<string, OpRec> = {};
  ref.fnOrder.forEach((name, i) => {
    const p = part(ref.hashes[i]);
    if (!p) throw new Error(`no part ${ref.hashes[i]} for ${name}`);
    fns[name] = p[0];
    for (const b of p[1]) blocks[b.id] = b;
    for (const s of p[2]) stmts[s.id] = s;
    for (const x of p[3]) values[x.id] = x;
    for (const o of p[4]) ops[o.id] = o;
  });
  // the records are canonical already, so this builds the tables only
  return immutable({
    formatVersion: 1,
    program: ref.program,
    rev: ref.rev,
    counters: ref.counters ?? {},
    fnOrder: ref.fnOrder,
    fns,
    blocks,
    stmts,
    values,
    ops,
    frontEnd: ref.frontEnd ?? {},
  }) as unknown as TypedBlocks;
}
/** The part texts of `v` whose hashes `have` lacks, as [hash, text] (and adds them to `have`). */
export function missingParts(v: TypedBlocks, have: Set<string>): [string, string][] {
  const out: [string, string][] = [];
  for (const p of partsOf(v).values()) {
    const h = partHash(p);
    if (!have.has(h)) {
      have.add(h);
      out.push([h, partText(p)]);
    }
  }
  return out;
}

const KEYS = new WeakMap<object, Map<string, string>>();
/**
 * The closure key of function `f` in `v`: equal for two values exactly when the code reachable from `f` (every such
 * function's part, by hash) and the frame-array flag are equal; cached per frozen value and function.
 */
export function closureKey(v: TypedBlocks, f: string): string {
  let m = KEYS.get(v);
  const cached = m?.get(f);
  if (cached !== undefined) return cached;
  const parts = partsOf(v);
  const lines = closureOf(v, f).map(g => {
    const p = parts.get(g);
    return `${g}:${p ? partHash(p) : 'missing'}`;
  });
  const key = sha256Parts([lines.join('\n'), `\nframes:${hasFrameArrays(v)}`]);
  if (isCanonical(v)) {
    if (!m) KEYS.set(v, (m = new Map()));
    m.set(f, key);
  }
  return key;
}
