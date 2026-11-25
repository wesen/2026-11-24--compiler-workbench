/**
 * `typed.blocks` as a v6 representation: its IR definition (validator) and its adapter (logical projection and
 * rebuild). The projection is what v6's generic machinery queries, matches, diffs and edits; the native tables
 * stay the storage.
 *
 * Entities: `fn`, `local`, `block`, `stmt.<op>`, `value.<op>`, `op`. Attributes hold everything that is not
 * structure; structure is relations only, so a draft edit and its rebuild agree exactly:
 *   containment  declares (fn -> local, by index), contains (fn -> block, block -> stmt, ordered), emits (fn -> op)
 *   dependency   uses (stmt -> value, attribute field = value|cond|addr), operand (value -> value, ordered),
 *                reads (get value -> local)
 *   binding      writes (set stmt -> local)
 *   control      succ (block -> block, ordered), jump (stmt -> block, attribute field = to|then|else)
 * Relation ids are position-based (`operand:v:f.3:0`), so redirecting an edge keeps its identity (v6 §9.2).
 */
import { defineIR } from '../framework/contracts/definitions.js';
import { defineAdapter } from '../framework/ir/adapters.js';
import type { IREntity, IRGraph, IRRelation } from '../framework/ir/types.js';
import {
  Store,
  type BlockRec,
  type FnRec,
  type LocalRec,
  type OpRec,
  type StmtRec,
  type TypedBlocks,
  type ValueRec,
} from './model.js';
import { describeText } from './listing.js';

const STMT_OPS = new Set(['set', 'store', 'eval', 'br', 'br_if', 'return', 'trap']);
const VALUE_OPS = new Set([
  'const',
  'get',
  'add',
  'sub',
  'mul',
  'div',
  'rem',
  'and',
  'or',
  'xor',
  'shl',
  'shr',
  'shru',
  'eq',
  'ne',
  'lt',
  'gt',
  'le',
  'ge',
  'ltu',
  'geu',
  'eqz',
  'load',
  'load16u',
  'call',
]);
const USE_FIELDS = ['value', 'cond', 'addr'] as const;
const JUMP_FIELDS = ['to', 'then', 'else'] as const;

class BlocksError extends Error {
  constructor(message: string) {
    super(`typed.blocks: ${message}`);
  }
}
const need = (cond: unknown, message: string): void => {
  if (!cond) throw new BlocksError(message);
};

export function validateBlocks(value: unknown): asserts value is TypedBlocks {
  const v = value as TypedBlocks;
  need(v && typeof v === 'object' && v.formatVersion === 1, 'formatVersion 1 required');
  for (const k of ['fns', 'blocks', 'stmts', 'values', 'ops', 'counters'] as const)
    need(v[k] && typeof v[k] === 'object', `${k} required`);
  need(typeof v.program === 'string' && v.program.length > 0, 'program name required');
  need(
    Array.isArray(v.fnOrder) &&
      v.fnOrder.length === Object.keys(v.fns).length &&
      v.fnOrder.every(n => v.fns[n]),
    'fnOrder must list every function once',
  );
  for (const [name, f] of Object.entries(v.fns)) {
    need(f.id === `fn:${name}` && f.name === name, `function ${name} has id ${f.id}`);
    need(
      Array.isArray(f.locals) && f.locals.every((l, i) => l.index === i),
      `function ${name}: locals must be indexed 0..n-1`,
    );
    need(f.params.length <= f.locals.length, `function ${name}: more params than locals`);
    for (const b of f.blocks) {
      const blk = v.blocks[b];
      need(blk && blk.fn === f.id, `function ${name}: block ${b} missing or in another function`);
      for (const t of blk.succ)
        need(v.blocks[t]?.fn === f.id, `block ${b}: successor ${t} is not a block of ${name}`);
      for (const s of blk.stmts) {
        const st = v.stmts[s];
        need(st && st.fn === f.id && STMT_OPS.has(st.op), `block ${b}: statement ${s} missing or malformed`);
        for (const k of USE_FIELDS)
          if (st[k] !== undefined)
            need(v.values[st[k]!]?.fn === f.id, `statement ${s}: ${k} ${st[k]} is not a value of ${name}`);
        for (const k of JUMP_FIELDS)
          if (st[k] !== undefined)
            need(v.blocks[st[k]!]?.fn === f.id, `statement ${s}: ${k} ${st[k]} is not a block of ${name}`);
        if (st.op === 'set')
          need(
            Number.isInteger(st.local) && st.local! >= 0 && st.local! < f.locals.length,
            `statement ${s}: bad local ${st.local}`,
          );
      }
    }
  }
  // value trees: arguments exist in the same function, no cycles
  const state = new Map<string, number>();
  const visit = (id: string): void => {
    const s = state.get(id);
    if (s === 2) return;
    need(s !== 1, `value ${id} is part of a cycle`);
    state.set(id, 1);
    const x = v.values[id];
    need(x && VALUE_OPS.has(x.op), `value ${id} missing or malformed`);
    for (const a of x.args) {
      need(v.values[a]?.fn === x.fn, `value ${id}: argument ${a} missing or in another function`);
      visit(a);
    }
    state.set(id, 2);
  };
  for (const id of Object.keys(v.values)) visit(id);
}

export const BlocksIR = defineIR<TypedBlocks>({
  id: 'typed.blocks',
  version: '1',
  description: 'Functions as blocks of statements over pure value trees, lifted from Typed stack code',
  validate: validateBlocks,
});

const entity = (id: string, kind: string, attributes: Record<string, unknown> = {}): IREntity => ({
  id,
  kind,
  attributes,
});
const rel = (
  id: string,
  kind: string,
  category: IRRelation['category'],
  from: string,
  to: string,
  order?: number,
  attributes?: Record<string, unknown>,
): IRRelation => ({
  id,
  kind,
  category,
  from,
  to,
  ...(order === undefined ? {} : { order }),
  ...(attributes ? { attributes } : {}),
});
const localId = (fnId: string, i: number) => `local:${fnId.slice(3)}/${i}`;
const omit = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(o).filter(([k, x]) => !keys.includes(k) && x !== undefined));

export function blocksEntities(v: TypedBlocks): IREntity[] {
  const out: IREntity[] = [];
  for (const f of Object.values(v.fns)) {
    out.push(
      entity(f.id, 'fn', omit(f as unknown as Record<string, unknown>, ['id', 'kind', 'locals', 'blocks'])),
    );
    f.locals.forEach(l => out.push(entity(localId(f.id, l.index), 'local', { ...l, fn: f.id })));
  }
  for (const b of Object.values(v.blocks))
    out.push(entity(b.id, 'block', omit(b as never, ['id', 'kind', 'stmts', 'succ'])));
  for (const s of Object.values(v.stmts))
    out.push(
      entity(
        s.id,
        `stmt.${s.op}`,
        omit(s as never, ['id', 'kind', 'op', 'local', ...USE_FIELDS, ...JUMP_FIELDS]),
      ),
    );
  for (const x of Object.values(v.values))
    out.push(
      entity(
        x.id,
        `value.${x.op}`,
        omit(x as never, ['id', 'kind', 'op', 'args', ...(x.op === 'get' ? ['imm'] : [])]),
      ),
    );
  for (const o of Object.values(v.ops)) out.push(entity(o.id, 'op', omit(o as never, ['id', 'kind'])));
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function blocksRelations(v: TypedBlocks): IRRelation[] {
  const out: IRRelation[] = [];
  for (const f of Object.values(v.fns)) {
    f.locals.forEach(l =>
      out.push(
        rel(`declares:${f.id}:${l.index}`, 'declares', 'containment', f.id, localId(f.id, l.index), l.index),
      ),
    );
    f.blocks.forEach((b, i) => out.push(rel(`contains:${f.id}:${i}`, 'contains', 'containment', f.id, b, i)));
  }
  for (const o of Object.values(v.ops)) out.push(rel(`emits:${o.id}`, 'emits', 'containment', o.fn, o.id));
  for (const b of Object.values(v.blocks)) {
    b.stmts.forEach((s, i) => out.push(rel(`contains:${b.id}:${i}`, 'contains', 'containment', b.id, s, i)));
    b.succ.forEach((t, i) => out.push(rel(`succ:${b.id}:${i}`, 'succ', 'control', b.id, t, i)));
  }
  for (const s of Object.values(v.stmts)) {
    USE_FIELDS.forEach((k, i) => {
      if (s[k] !== undefined)
        out.push(rel(`uses:${s.id}:${k}`, 'uses', 'dependency', s.id, s[k]!, i, { field: k }));
    });
    JUMP_FIELDS.forEach((k, i) => {
      if (s[k] !== undefined)
        out.push(rel(`jump:${s.id}:${k}`, 'jump', 'control', s.id, s[k]!, i, { field: k }));
    });
    if (s.op === 'set') out.push(rel(`writes:${s.id}`, 'writes', 'binding', s.id, localId(s.fn, s.local!)));
  }
  for (const x of Object.values(v.values)) {
    x.args.forEach((a, i) => out.push(rel(`operand:${x.id}:${i}`, 'operand', 'dependency', x.id, a, i)));
    if (x.op === 'get')
      out.push(rel(`reads:${x.id}`, 'reads', 'dependency', x.id, localId(x.fn, x.imm as number)));
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Logical graph -> native tables. Counters advance past any id an edit inserted, so later fresh ids stay unique. */
export function rebuildBlocks(base: TypedBlocks, graph: IRGraph): TypedBlocks {
  const byId = new Map(graph.entities.map(e => [e.id, e]));
  const out = (from: string, kind: string) =>
    graph.relations
      .filter(r => r.from === from && r.kind === kind)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const field = (from: string, kind: string, f: string) =>
    out(from, kind).find(r => r.attributes?.field === f)?.to;
  const localIndex = (localEntity: string | undefined) =>
    localEntity === undefined ? undefined : (byId.get(localEntity)!.attributes.index as number);
  const fns: Record<string, FnRec & { blocks: string[] }> = {},
    blocks: Record<string, BlockRec> = {},
    stmts: Record<string, StmtRec> = {},
    values: Record<string, ValueRec> = {},
    ops: Record<string, OpRec> = {};
  for (const e of graph.entities) {
    const a = e.attributes as Record<string, any>;
    if (e.kind === 'fn') {
      const locals = out(e.id, 'declares').map(r => {
        const { fn: _fn, ...l } = byId.get(r.to)!.attributes as Record<string, any>;
        return l as LocalRec;
      });
      fns[a.name] = {
        id: e.id,
        kind: 'function',
        name: a.name,
        params: a.params,
        result: a.result,
        origin: a.origin,
        locals,
        blocks: out(e.id, 'contains').map(r => r.to),
      };
    } else if (e.kind === 'block') {
      blocks[e.id] = {
        id: e.id,
        kind: 'block',
        fn: a.fn,
        origin: a.origin,
        stmts: out(e.id, 'contains').map(r => r.to),
        succ: out(e.id, 'succ').map(r => r.to),
      };
    } else if (e.kind.startsWith('stmt.')) {
      const s: Record<string, unknown> = { id: e.id, kind: 'stmt', fn: a.fn, op: e.kind.slice(5) };
      const w = out(e.id, 'writes')[0];
      if (w) s.local = localIndex(w.to);
      for (const k of USE_FIELDS) {
        const t = field(e.id, 'uses', k);
        if (t !== undefined) s[k] = t;
      }
      for (const k of JUMP_FIELDS) {
        const t = field(e.id, 'jump', k);
        if (t !== undefined) s[k] = t;
      }
      for (const [k, x] of Object.entries(a)) if (k !== 'fn') s[k] = x;
      stmts[e.id] = s as unknown as StmtRec;
    } else if (e.kind.startsWith('value.')) {
      const op = e.kind.slice(6);
      const x: Record<string, unknown> = {
        id: e.id,
        kind: 'value',
        fn: a.fn,
        op,
        args: out(e.id, 'operand').map(r => r.to),
      };
      if (op === 'get') x.imm = localIndex(out(e.id, 'reads')[0]?.to);
      for (const [k, y] of Object.entries(a)) if (k !== 'fn') x[k] = y;
      values[e.id] = x as unknown as ValueRec;
    } else if (e.kind === 'op') ops[e.id] = { id: e.id, kind: 'op', ...(a as Omit<OpRec, 'id' | 'kind'>) };
  }
  const counters: Record<string, number> = { ...base.counters };
  for (const id of [...Object.keys(stmts), ...Object.keys(values)]) {
    const m = /^(.*)\.(\d+)$/.exec(id);
    if (m) counters[m[1]] = Math.max(counters[m[1]] ?? 0, +m[2] + 1);
  }
  const sortKeys = <T>(o: Record<string, T>) =>
    Object.fromEntries(Object.entries(o).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  const result: TypedBlocks = {
    formatVersion: 1,
    program: base.program,
    counters: sortKeys(counters),
    fnOrder: base.fnOrder.filter(n => fns[n]),
    fns: sortKeys(fns),
    blocks: sortKeys(blocks),
    stmts: sortKeys(stmts),
    values: sortKeys(values),
    ops: sortKeys(ops),
    frontEnd: base.frontEnd,
  };
  validateBlocks(result);
  return result;
}

const storeCache = new WeakMap<object, Store>();
/** A read-only working store for a native value (cached per immutable value) for printing and queries. */
export function storeOf(v: TypedBlocks): Store {
  let st = storeCache.get(v);
  if (!st) storeCache.set(v, (st = Store.from(v)));
  return st;
}

export const blocksAdapter = defineAdapter<TypedBlocks>({
  id: 'adapter.typed-blocks',
  version: '1',
  kind: BlocksIR.id,
  schemaVersion: BlocksIR.version,
  description:
    'Functions, locals, blocks, statements and value trees with typed control, data and binding edges',
  relationKinds: {
    declares: 'containment',
    contains: 'containment',
    emits: 'containment',
    uses: 'dependency',
    operand: 'dependency',
    reads: 'dependency',
    writes: 'binding',
    succ: 'control',
    jump: 'control',
  },
  entities: blocksEntities,
  resolve: (v, id) => blocksEntities(v).find(e => e.id === id),
  relations: blocksRelations,
  roots: v =>
    Object.values(v.fns)
      .map(f => f.id)
      .sort(),
  describe: (v, id) => ({ label: id.startsWith('local:') ? id : describeText(storeOf(v), id) }),
  validate: validateBlocks,
  rebuild: rebuildBlocks,
  operation: (v, id) => (v.values[id] ? { name: v.values[id].op, operands: v.values[id].args } : undefined),
  serialize: v => JSON.stringify(v),
  deserialize: s => {
    const v = JSON.parse(s);
    validateBlocks(v);
    return v;
  },
});
