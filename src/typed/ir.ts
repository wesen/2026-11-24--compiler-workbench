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
  type TypeClass,
  type TypedBlocks,
  type ValueOp,
  type ValueRec,
  typeClass,
} from './model.js';
import { describeText } from './listing.js';

const STMT_OPS = new Set(['set', 'store', 'eval', 'br', 'br_if', 'return', 'trap', 'zero']);

/**
 * Operator signatures: operand type classes and result class. `null` operands are checked per operator (call,
 * tuple); a result of 'typed' is the value's own `type` (const, load, result); 'local' is the local's class (get);
 * 'callee' is the callee's result (call). A multi-result call and a tuple have no scalar result ('none').
 */
type Sig = {
  readonly args: readonly TypeClass[] | null;
  readonly result: TypeClass | 'typed' | 'local' | 'callee' | 'none';
};
const I32: TypeClass = 'i32',
  F32: TypeClass = 'f32';
const sig = (args: readonly TypeClass[] | null, result: Sig['result']): Sig => ({ args, result });
export const VALUE_SIGNATURES: Readonly<Record<ValueOp, Sig>> = {
  const: sig([], 'typed'),
  get: sig([], 'local'),
  ...(Object.fromEntries(
    ['add', 'sub', 'mul', 'div', 'rem', 'and', 'or', 'xor', 'shl', 'shr', 'shru']
      .concat(['eq', 'ne', 'lt', 'gt', 'le', 'ge', 'ltu', 'geu'])
      .map(op => [op, sig([I32, I32], I32)]),
  ) as Record<string, Sig>),
  eqz: sig([I32], I32),
  load: sig([I32], 'typed'),
  load16u: sig([I32], I32),
  call: sig(null, 'callee'),
  ...(Object.fromEntries(
    ['fadd', 'fsub', 'fmul', 'fdiv', 'fmin', 'fmax', 'fcopysign'].map(op => [op, sig([F32, F32], F32)]),
  ) as Record<string, Sig>),
  ...(Object.fromEntries(
    ['fneg', 'fabs', 'fsqrt', 'ffloor', 'fceil', 'ftrunc'].map(op => [op, sig([F32], F32)]),
  ) as Record<string, Sig>),
  ...(Object.fromEntries(
    ['feq', 'fne', 'flt', 'fgt', 'fle', 'fge'].map(op => [op, sig([F32, F32], I32)]),
  ) as Record<string, Sig>),
  f2i: sig([F32], I32),
  f2u: sig([F32], I32),
  f2bits: sig([F32], I32),
  i2f: sig([I32], F32),
  u2f: sig([I32], F32),
  bits2f: sig([I32], F32),
  caddr: sig([I32, I32], I32),
  aaddr: sig([], I32),
  result: sig([], 'typed'),
  tuple: sig(null, 'none'),
} as Record<ValueOp, Sig>;
const VALUE_OPS = new Set(Object.keys(VALUE_SIGNATURES));
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
  need(Number.isInteger(v.rev) && v.rev >= 0, 'rev must be a revision number');
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
  checkTypes(v);
}

/**
 * Types: every operator gets operands of its classes, a set stores a value of its local's class, a return returns
 * the function's result (a tuple of its leaves for a record result), a multi-result call is the whole value of an
 * `eval`, and addresses of the frame array area stay inside it.
 */
function checkTypes(v: TypedBlocks): void {
  const fnOf = (fnId: string) => v.fns[fnId.slice(3)];
  const argOf = new Set<string>();
  for (const x of Object.values(v.values)) for (const a of x.args) argOf.add(a);
  const types = new Map<string, TypeClass | 'none'>();
  const typeOf = (id: string): TypeClass | 'none' => {
    let t = types.get(id);
    if (t) return t;
    const x = v.values[id],
      s = VALUE_SIGNATURES[x.op],
      f = fnOf(x.fn);
    need(x.type === undefined || x.type === 'f32', `value ${id}: type must be absent (i32) or 'f32'`);
    const own: TypeClass = x.type ?? 'i32';
    if (s.args) {
      need(x.args.length === s.args.length, `value ${id}: ${x.op} takes ${s.args.length} operands`);
      x.args.forEach((a, i) =>
        need(
          typeOf(a) === s.args![i],
          `value ${id}: operand ${i} of ${x.op} must be ${s.args![i]}, not ${typeOf(a)}`,
        ),
      );
    }
    switch (s.result) {
      case 'typed':
        t = own;
        break;
      case 'local': {
        const l = f.locals[x.imm as number];
        need(l, `value ${id}: get of a missing local ${x.imm}`);
        t = typeClass(l.type);
        need(own === t, `value ${id}: get of ${t} local ${l.name} must have type ${t}`);
        break;
      }
      case 'callee': {
        const callee = v.fns[x.imm as string];
        need(callee, `value ${id}: call of an unknown function ${x.imm}`);
        need(
          x.args.length === callee.params.length,
          `value ${id}: ${x.imm} takes ${callee.params.length} arguments`,
        );
        x.args.forEach((a, i) =>
          need(
            typeOf(a) === typeClass(callee.params[i]),
            `value ${id}: argument ${i} of ${x.imm} must be ${typeClass(callee.params[i])}, not ${typeOf(a)}`,
          ),
        );
        t = callee.results ? 'none' : typeClass(callee.result);
        need(
          callee.results ? x.type === undefined : own === t,
          `value ${id}: call of ${x.imm} must have type ${t}`,
        );
        break;
      }
      case 'none':
        t = 'none';
        need(x.type === undefined, `value ${id}: ${x.op} has no scalar type`);
        break;
      default:
        t = s.result;
        need(own === t, `value ${id}: ${x.op} must have type ${t}`);
    }
    if (x.op === 'tuple') {
      need(
        f.results && x.args.length === f.results.length,
        `value ${id}: a tuple must have ${f.name}'s result leaves`,
      );
      x.args.forEach((a, i) =>
        need(
          typeOf(a) === typeClass(f.results![i]),
          `value ${id}: leaf ${i} must be ${typeClass(f.results![i])}`,
        ),
      );
    }
    if (x.op === 'aaddr')
      need(
        Number.isInteger(x.imm) && (x.imm as number) >= 0 && (x.imm as number) < (f.arrayBytes ?? 0),
        `value ${id}: array offset ${x.imm} outside ${f.name}'s array area`,
      );
    if (x.op === 'result')
      need(Number.isInteger(x.imm) && (x.imm as number) >= 0, `value ${id}: bad result leaf`);
    if (t === 'none') need(!argOf.has(id), `value ${id}: ${x.op} cannot be an operand`);
    types.set(id, t);
    return t;
  };
  for (const s of Object.values(v.stmts)) {
    const f = fnOf(s.fn);
    const vt = s.value === undefined ? undefined : typeOf(s.value);
    switch (s.op) {
      case 'set': {
        const want = typeClass(f.locals[s.local!].type);
        need(
          vt === want,
          `statement ${s.id}: a ${vt} value set into ${want} local ${f.locals[s.local!].name}`,
        );
        break;
      }
      case 'store':
        need(typeOf(s.addr!) === 'i32', `statement ${s.id}: a store address must be i32`);
        need(
          s.width === 32 ? vt !== 'none' : vt === 'i32',
          `statement ${s.id}: store${s.width} of a ${vt} value`,
        );
        break;
      case 'eval':
        need(vt !== 'none' || v.values[s.value!].op === 'call', `statement ${s.id}: eval of a tuple`);
        break;
      case 'br_if':
        need(typeOf(s.cond!) === 'i32', `statement ${s.id}: a branch condition must be i32`);
        break;
      case 'return':
        if (f.results)
          need(v.values[s.value!].op === 'tuple', `statement ${s.id}: ${f.name} returns a tuple`);
        else
          need(
            vt === typeClass(f.result),
            `statement ${s.id}: ${f.name} returns ${typeClass(f.result)}, not ${vt}`,
          );
        break;
      case 'zero':
        need(
          Number.isInteger(s.offset) &&
            Number.isInteger(s.bytes) &&
            s.offset! >= 0 &&
            s.bytes! >= 0 &&
            s.offset! + s.bytes! <= (f.arrayBytes ?? 0),
          `statement ${s.id}: zero outside ${f.name}'s array area`,
        );
        break;
    }
  }
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
  // relations by source and kind, indexed once (a per-entity scan is quadratic on a program of Candela's size)
  const bySource = new Map<string, IRRelation[]>();
  for (const r of graph.relations) {
    const k = `${r.from}\u0000${r.kind}`;
    const list = bySource.get(k);
    if (list) list.push(r);
    else bySource.set(k, [r]);
  }
  const out = (from: string, kind: string) =>
    (bySource.get(`${from}\u0000${kind}`) ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
        ...(a.results ? { results: a.results } : {}),
        ...(a.arrayBytes ? { arrayBytes: a.arrayBytes } : {}),
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
    rev: base.rev,
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

const entityCache = new WeakMap<object, Map<string, IREntity>>();
/** The projection's entities of a native value by id, built once per immutable value (v6 resolves each one). */
function entityIndex(v: TypedBlocks): Map<string, IREntity> {
  let m = entityCache.get(v);
  if (!m) entityCache.set(v, (m = new Map(blocksEntities(v).map(e => [e.id, e]))));
  return m;
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
  resolve: (v, id) => entityIndex(v).get(id),
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
