/**
 * The front end (reused unchanged from ds-js-os) and lifting: stack code with structured control into a CFG of
 * statements over value trees. A port of Compiler Workbench's store.js `frontEnd`, `lift` and `prune`; the
 * algorithms are the prototype's, written against the typed working store.
 *
 * Values are trees; a value has one user. The operand stack is materialized into temporaries wherever evaluation
 * order could change: before a local it reads is assigned, before memory changes, before a call, around control.
 *
 * Three front ends feed the same lifter:
 *   - `frontEnd` (the default): `typedWasm.compile` with inspection. Its events describe the Wasm backend's operations,
 *     decoded from the Wasm bytes, so the tape's pseudo-ops arrive expanded (a checked address is a capacity load, a
 *     branch over `unreachable`, a shift and an add). The Compiler Workbench corpus is lifted this way. A program whose
 *     Wasm encoding uses operations the tape does not have (f32.min_num, f32.max_num, f32.to_i32 expand to Wasm's
 *     f32.min, select, i32.trunc_sat) cannot be inspected this way: "unknown tape opcode 151".
 *   - `frontEndTape`: `typedWasm.compileFunctions`, the front end's own entry, which hands over each function's tape.
 *     With `spans` (the default) its inspection events give the tape's operations with source spans and the named
 *     locals; without, the tape is decoded raw (`typedTape.decode`) and ops have `at: null`.
 * Local types are inferred from the tape (parameters from the signature, every other local from the values its
 * `local.set`s store, to a fixpoint) and checked against the types the front end declares.
 */
import { requireVendor, type TapeRow } from './vendor.js';
import {
  Store,
  typeClass,
  type BlockRec,
  type FrontEndInfo,
  type Origin,
  type SourcePos,
  type StmtRec,
  type TypeClass,
  type ValueOp,
  type ValueRec,
  type WorkFn,
} from './model.js';

/** Wasm-style op names of the front end -> the IR's short names. */
export const BINOPS: Readonly<Record<string, ValueOp>> = {
  'i32.add': 'add',
  'i32.sub': 'sub',
  'i32.mul': 'mul',
  'i32.div_s': 'div',
  'i32.rem_s': 'rem',
  'i32.and': 'and',
  'i32.or': 'or',
  'i32.xor': 'xor',
  'i32.shl': 'shl',
  'i32.shr_s': 'shr',
  'i32.shr_u': 'shru',
  'i32.eq': 'eq',
  'i32.ne': 'ne',
  'i32.lt_s': 'lt',
  'i32.gt_s': 'gt',
  'i32.le_s': 'le',
  'i32.ge_s': 'ge',
  'i32.lt_u': 'ltu',
  'i32.ge_u': 'geu',
};
/** The tape's f32 operations with two operands (f32 results, or i32 for the comparisons). */
export const F32_BINOPS: Readonly<Record<string, ValueOp>> = {
  'f32.add': 'fadd',
  'f32.sub': 'fsub',
  'f32.mul': 'fmul',
  'f32.div': 'fdiv',
  'f32.min_num': 'fmin',
  'f32.max_num': 'fmax',
  'f32.copysign': 'fcopysign',
  'f32.eq': 'feq',
  'f32.ne': 'fne',
  'f32.lt': 'flt',
  'f32.gt': 'fgt',
  'f32.le': 'fle',
  'f32.ge': 'fge',
};
/** The tape's one-operand f32 operations and conversions. */
export const F32_UNOPS: Readonly<Record<string, ValueOp>> = {
  'f32.neg': 'fneg',
  'f32.abs': 'fabs',
  'f32.sqrt': 'fsqrt',
  'f32.floor': 'ffloor',
  'f32.ceil': 'fceil',
  'f32.trunc': 'ftrunc',
  'f32.to_i32': 'f2i',
  'f32.to_u32': 'f2u',
  'i32.reinterpret_f32': 'f2bits',
  'f32.convert_i32_s': 'i2f',
  'f32.convert_i32_u': 'u2f',
  'f32.reinterpret_i32': 'bits2f',
};
const F32_RESULTS = new Set(
  ['fadd', 'fsub', 'fmul', 'fdiv', 'fmin', 'fmax', 'fcopysign', 'fneg', 'fabs', 'fsqrt'].concat([
    'ffloor',
    'fceil',
    'ftrunc',
    'i2f',
    'u2f',
    'bits2f',
  ]),
);

export class LiftError extends Error {
  constructor(
    readonly code: 'frontEndError' | 'unsupportedOp' | 'typeConflict',
    message: string,
    readonly at?: { line: number; col: number },
  ) {
    super(message);
    this.name = 'LiftError';
  }
}

export interface FrontEndOp {
  ordinal: number;
  op: string;
  operands: number[];
  at: SourcePos | null;
}
export interface FrontEndFn {
  name: string;
  params: string[];
  result: string;
  /** The leaf types of a value-record result. */
  results?: string[];
  /** The size of the frame array area (array.address, array.zero). */
  arrayBytes?: number;
  /** The text of each `text.literal_stores` literal. */
  literals?: string[];
  localCount: number;
  /** The locals the front end names (all parameters, declared locals); the others are temporaries. */
  locals: {
    index: number;
    name: string;
    type: string;
    mutable: boolean;
    param: boolean;
    at: SourcePos | null;
  }[];
  ops: FrontEndOp[];
}
export interface FrontEnd {
  fns: FrontEndFn[];
  info: FrontEndInfo;
}

const frontEndError = (e: unknown): LiftError => {
  const m = /^(\d+):(\d+): (.*)$/s.exec((e as Error).message);
  return new LiftError(
    'frontEndError',
    m ? m[3] : (e as Error).message,
    m ? { line: +m[1], col: +m[2] } : undefined,
  );
};
const json = (x: unknown) => (x === undefined ? null : JSON.parse(JSON.stringify(x)));

/** Offset -> line and column, for source spans. */
function positions(source: string): (off: number) => SourcePos {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  return (off: number): SourcePos => {
    let lo = 0,
      hi = starts.length;
    while (lo + 1 < hi) {
      const m = (lo + hi) >> 1;
      if (starts[m] <= off) lo = m;
      else hi = m;
    }
    return { line: lo + 1, col: off - starts[lo] + 1 };
  };
}
const eventLocals = (e: any, pos: (off: number) => SourcePos): FrontEndFn['locals'] =>
  e.locals.map((l: any) => ({
    index: l.index,
    name: l.name,
    type: l.type,
    mutable: l.mutable,
    param: l.parameter,
    at: l.source ? pos(l.source.start) : null,
  }));
const eventOps = (e: any, pos: (off: number) => SourcePos): FrontEndOp[] =>
  e.operations.map((o: any) => ({
    ordinal: o.ordinal,
    op: o.op,
    operands: o.operands,
    at: o.source ? { ...pos(o.source.start), start: o.source.start, end: o.source.end } : null,
  }));

/** Run the reused front end with its inspection callback: per function, locals and ops with source spans. */
export function frontEnd(source: string, options: { maxSourceLength?: number } = {}): FrontEnd {
  const typedWasm = requireVendor('typedWasm');
  const events: any[] = [];
  let out: any;
  try {
    out = typedWasm.compile(source, {
      ...(options.maxSourceLength ? { maxSourceLength: options.maxSourceLength } : {}),
      inspect: { emit: (e: unknown) => events.push(e) },
    });
  } catch (e) {
    throw frontEndError(e);
  }
  const pos = positions(source);
  const results = new Map<string, string[]>(
    ((out.signatures ?? []) as any[]).filter(s => s.results).map(s => [s.name, s.results]),
  );
  const fns: FrontEndFn[] = events
    .filter(e => e.kind === 'frontend')
    .map(f => ({
      name: f.function,
      params: f.params,
      result: f.result,
      ...(results.has(f.function) ? { results: results.get(f.function) } : {}),
      localCount: f.localCount,
      locals: eventLocals(f, pos),
      ops: eventOps(f, pos),
    }));
  return {
    fns,
    info: {
      wasmBytes: out.bytes.length,
      records: json(out.records),
      enums: json(out.enums),
      signatures: json(out.signatures),
    },
  };
}

/**
 * The front end's tape, through its own entry `compileFunctions`: with `spans`, its inspection events (the tape's
 * operations with source spans, the named locals and their declared types); without, the raw tape decoded with
 * `typedTape.decode` (ops at `null`; locals other than parameters are unnamed temporaries).
 */
export function frontEndTape(
  source: string,
  options: { maxSourceLength?: number; spans?: boolean } = {},
): FrontEnd {
  const typedWasm = requireVendor('typedWasm'),
    tape = requireVendor('typedTape');
  const spans = options.spans ?? true;
  const events = new Map<string, any>(),
    raw: any[] = [];
  let prog: any;
  try {
    prog = typedWasm.compileFunctions(
      source,
      0,
      [],
      options.maxSourceLength ?? 64 * 1024,
      undefined,
      fn =>
        raw.push({
          name: fn.name,
          params: fn.params.slice(),
          paramNames: fn.paramNames.slice(),
          result: fn.result,
          results: fn.results?.slice(),
          nlocals: fn.nlocals,
          arrayBytes: fn.arrayBytes,
          literals: fn.literals?.slice(),
          code: Array.from(fn.code as ArrayLike<number>),
        }),
      undefined,
      spans
        ? { inspect: { emit: (e: any) => e.kind === 'frontend' && events.set(e.function, e) } }
        : undefined,
    );
  } catch (e) {
    throw frontEndError(e);
  }
  const pos = positions(source);
  const fns: FrontEndFn[] = raw.map(fn => {
    const e = events.get(fn.name);
    return {
      name: fn.name,
      params: fn.params,
      result: fn.result,
      ...(fn.results ? { results: fn.results } : {}),
      ...(fn.arrayBytes ? { arrayBytes: fn.arrayBytes } : {}),
      ...(fn.literals ? { literals: fn.literals } : {}),
      localCount: fn.params.length + fn.nlocals,
      locals: e
        ? eventLocals(e, pos)
        : fn.params.map((type: string, i: number) => ({
            index: i,
            name: fn.paramNames[i],
            type,
            mutable: false,
            param: true,
            at: null,
          })),
      ops: e
        ? eventOps(e, pos)
        : tape.decode(fn.code).map(o => ({ ordinal: o.ordinal, op: o.op, operands: o.operands, at: null })),
    };
  });
  return {
    fns,
    info: {
      wasmBytes: 0,
      records: json(typedWasm.recordLayouts(prog.records)),
      enums: json(typedWasm.enumLayouts(prog.enums)),
      signatures: json(prog.functions.map((f: unknown) => typedWasm.publicSignature(f))),
    },
  };
}

interface Signature {
  name: string;
  params: string[];
  result: string;
  results?: string[];
}

let rowsByName: Map<string, TapeRow> | null = null;
const rowOf = (name: string): TapeRow | undefined => {
  if (!rowsByName) rowsByName = new Map(requireVendor('typedTape').rows.map(r => [r.name, r]));
  return rowsByName.get(name);
};

/**
 * The type class of every local of `f`: parameters and named locals as declared; every other local the class of the
 * values its `local.set`s store, found by simulating the operand stack's types (rows' pops and pushes, callees'
 * signatures, block types) until no local changes. A local nobody assigns is i32. Throws `typeConflict` when a local
 * is given values of both classes, or when a named local's declared type disagrees with what it is given.
 */
export function inferLocalTypes(f: FrontEndFn, signatures: readonly Signature[]): TypeClass[] {
  const tape = requireVendor('typedTape');
  const n = Math.max(f.localCount, ...f.locals.map(l => l.index + 1));
  const declared: (TypeClass | null)[] = new Array(n).fill(null);
  f.params.forEach((t, i) => (declared[i] = typeClass(t)));
  for (const l of f.locals) declared[l.index] = typeClass(l.type);
  const width = f.results ? f.results.length : 1;
  const blockType = (cell: number): TypeClass | null =>
    cell === tape.F32 ? 'f32' : cell === tape.I32 ? 'i32' : null;
  type T = TypeClass | '?';
  let known = declared.slice();
  for (let round = 0; ; round++) {
    const next = declared.slice(),
      conflicts: string[] = [];
    const stack: T[] = [],
      ctl: { height: number; type: TypeClass | null; dead: boolean; isIf: boolean }[] = [];
    let dead = false;
    const pop = (k = 1) => stack.splice(Math.max(0, stack.length - k), k);
    for (const o of f.ops) {
      const op = o.op;
      if (op === 'block' || op === 'loop' || op === 'if') {
        if (op === 'if' && !dead) pop();
        ctl.push({ height: stack.length, type: blockType(o.operands[0]), dead, isIf: op === 'if' });
        continue;
      }
      if (op === 'else') {
        const c = ctl.at(-1)!;
        stack.length = c.height;
        dead = c.dead;
        continue;
      }
      if (op === 'end') {
        const c = ctl.pop();
        if (!c) break;
        stack.length = c.height;
        dead = c.dead;
        if (c.type) stack.push(c.type);
        continue;
      }
      if (dead) continue;
      switch (op) {
        case 'local.get':
          stack.push(known[o.operands[0]] ?? '?');
          continue;
        case 'local.set': {
          const L = o.operands[0],
            [t] = pop();
          if (t === '?' || t === undefined) continue;
          if (next[L] === null) next[L] = t;
          else if (next[L] !== t)
            conflicts.push(`${f.name}: local ${L} is ${next[L]} and is given an ${t} (op ${o.ordinal})`);
          continue;
        }
        case 'call': {
          const callee = signatures[o.operands[0]];
          pop(callee ? callee.params.length : 0);
          if (callee) for (const r of callee.results ?? [callee.result]) stack.push(typeClass(r));
          continue;
        }
        case 'return':
          pop(width);
          dead = true;
          continue;
        case 'br':
        case 'unreachable':
          dead = true;
          continue;
        case 'drop':
          pop();
          continue;
      }
      const row = rowOf(op);
      if (!row) continue; // the lifter reports it
      pop(row.pop?.length ?? 0);
      for (const p of row.push) stack.push(p === tape.F32 ? 'f32' : 'i32');
    }
    const settled = next.every((t, i) => t === known[i]);
    known = next;
    if (settled || round > n + 2) {
      if (conflicts.length) throw new LiftError('typeConflict', conflicts[0]);
      return known.map(t => t ?? 'i32');
    }
  }
}

const TERMINATORS = new Set(['br', 'br_if', 'return', 'trap']);

export function lift(store: Store, fe: FrontEnd, f: FrontEndFn): WorkFn {
  const F = f.name;
  const signatures = ((fe.info.signatures as Signature[] | null) ?? []) as Signature[];
  const types = inferLocalTypes(f, signatures);
  const fn: WorkFn = {
    id: `fn:${F}`,
    kind: 'function',
    name: F,
    params: f.params.slice(),
    result: f.result,
    ...(f.results ? { results: f.results.slice() } : {}),
    ...(f.arrayBytes ? { arrayBytes: f.arrayBytes } : {}),
    locals: [],
    blocks: [],
    origin: [{ from: 'source', via: 'ingest', kind: 'recorded' }],
  };
  const named = new Map(f.locals.map(l => [l.index, l]));
  const ensureLocal = (i: number) => {
    while (fn.locals.length <= i) {
      const k = fn.locals.length,
        l = named.get(k);
      fn.locals.push(
        l
          ? { index: k, name: l.name, type: l.type, param: !!l.param, mutable: !!l.mutable, at: l.at }
          : {
              index: k,
              name: `t${k}`,
              type: types[k] ?? 'i32',
              param: false,
              mutable: true,
              temp: 'front end',
            },
      );
    }
  };
  ensureLocal(f.localCount - 1);
  const newTemp = (why: string, type: TypeClass = 'i32') => {
    const k = fn.locals.length;
    fn.locals.push({ index: k, name: `t${k}`, type, param: false, mutable: true, temp: why });
    return k;
  };
  store.add(fn);
  const blockOf = (): BlockRec => {
    const b: BlockRec = {
      id: `bb:${F}.${fn.blocks.length}`,
      kind: 'block',
      fn: fn.id,
      stmts: [],
      succ: [],
      origin: [],
    };
    fn.blocks.push(b);
    store.add(b);
    return b;
  };
  const origin = (o: { ordinal: number }): Origin[] => [
    { from: `op:${F}#${o.ordinal}`, via: 'ingest', kind: 'recorded' },
  ];
  const val = (
    op: ValueOp,
    args: string[],
    imm: number | string | undefined,
    o: { ordinal: number },
    type: TypeClass = 'i32',
  ) =>
    store.add<ValueRec>({
      id: store.fresh(`v:${F}`),
      kind: 'value',
      fn: fn.id,
      op,
      args,
      ...(type === 'f32' ? { type } : {}),
      ...(imm === undefined ? {} : { imm }),
      origin: origin(o),
    }).id;
  const typeOf = (id: string): TypeClass => ((store.get(id) as ValueRec).type === 'f32' ? 'f32' : 'i32');
  let cur = blockOf();
  const stmt = (
    s: Partial<StmtRec> & { op: StmtRec['op'] },
    o: { ordinal: number },
    note?: string,
  ): StmtRec => {
    const e = store.add<StmtRec>({
      id: store.fresh(`s:${F}`),
      kind: 'stmt',
      fn: fn.id,
      ...s,
      origin: origin(o).map(x => (note ? { ...x, note } : x)),
    } as StmtRec);
    cur.stmts.push(e.id);
    if (!cur.origin.length) cur.origin = origin(o);
    return e;
  };
  const reads = (id: string, pred: (v: ValueRec) => boolean): boolean => {
    const v = store.get(id) as ValueRec;
    return pred(v) || v.args.some(a => reads(a, pred));
  };
  // values whose meaning a store or a call could change: loads (and a checked address's capacity load), calls, and
  // the leaves of a multi-result call (the next call replaces them)
  const memoryOrCall = (x: ValueRec) =>
    x.op === 'load' || x.op === 'load16u' || x.op === 'call' || x.op === 'caddr' || x.op === 'result';
  const stack: string[] = [],
    ctl: any[] = [];
  const flush = (pred: (id: string) => boolean, o: { ordinal: number }, why: string) => {
    for (let i = 0; i < stack.length; i++) {
      const v = store.get(stack[i]) as ValueRec;
      if (v.op === 'const' || (v.op === 'get' && why === 'control') || !pred(stack[i])) continue;
      const t = newTemp(why, typeOf(stack[i]));
      stmt({ op: 'set', local: t, value: stack[i] }, o, `stack value kept in t${t} (${why})`);
      stack[i] = val('get', [], t, o, typeOf(stack[i]));
    }
  };
  const terminated = () =>
    cur.stmts.length > 0 && TERMINATORS.has((store.get(cur.stmts.at(-1)!) as StmtRec).op);
  const jump = (to: BlockRec, o: { ordinal: number }) => {
    if (!terminated()) {
      stmt({ op: 'br', to: to.id }, o);
      cur.succ.push(to.id);
    }
  };
  const endOf = (c: any): BlockRec => c.end || (c.end = blockOf());
  const target = (k: number): BlockRec | null => {
    const c = ctl[ctl.length - 1 - k];
    if (!c) return null;
    return c.kind === 'loop' ? c.head : endOf(c);
  };
  const sigName = (i: number) => signatures[i]?.name;
  const get = (L: number, o: { ordinal: number }) => {
    ensureLocal(L);
    return val('get', [], L, o, typeClass(fn.locals[L].type));
  };
  // the function's result: one value, or a tuple of a value record's leaves
  const returned = (o: { ordinal: number }): string => {
    if (f.results)
      return val('tuple', stack.splice(stack.length - f.results.length, f.results.length), undefined, o);
    return stack.length ? stack.pop()! : val('const', [], 0, o, typeClass(f.result));
  };
  const blockResult = (cell: number): TypeClass | null =>
    cell === 0x7f ? 'i32' : cell === 0x7d ? 'f32' : null;
  for (const o of f.ops) {
    const opId = `op:${F}#${o.ordinal}`;
    if (!store.has(opId))
      store.add({ id: opId, kind: 'op', fn: fn.id, op: o.op, operands: o.operands, at: o.at });
    const op = o.op;
    if (op === 'i32.const') stack.push(val('const', [], o.operands[0] | 0, o));
    else if (op === 'f32.const') stack.push(val('const', [], o.operands[0] | 0, o, 'f32'));
    else if (op === 'local.get') stack.push(get(o.operands[0], o));
    else if (op === 'local.set') {
      const L = o.operands[0];
      ensureLocal(L);
      const v = stack.pop()!;
      flush(id => reads(id, x => x.op === 'get' && x.imm === L), o, `before ${fn.locals[L].name} changes`);
      stmt({ op: 'set', local: L, value: v }, o);
    } else if (BINOPS[op]) {
      const b = stack.pop()!,
        a = stack.pop()!;
      stack.push(val(BINOPS[op], [a, b], undefined, o));
    } else if (F32_BINOPS[op]) {
      const b = stack.pop()!,
        a = stack.pop()!,
        x = F32_BINOPS[op];
      stack.push(val(x, [a, b], undefined, o, F32_RESULTS.has(x) ? 'f32' : 'i32'));
    } else if (F32_UNOPS[op]) {
      const x = F32_UNOPS[op];
      stack.push(val(x, [stack.pop()!], undefined, o, F32_RESULTS.has(x) ? 'f32' : 'i32'));
    } else if (op === 'i32.eqz') stack.push(val('eqz', [stack.pop()!], undefined, o));
    else if (op === 'i32.load' || op === 'i32.load16_u' || op === 'f32.load')
      stack.push(
        val(
          op === 'i32.load16_u' ? 'load16u' : 'load',
          [stack.pop()!],
          o.operands[1],
          o,
          op === 'f32.load' ? 'f32' : 'i32',
        ),
      );
    else if (op === 'i32.store' || op === 'i32.store16' || op === 'f32.store') {
      const v = stack.pop()!,
        a = stack.pop()!;
      flush(id => reads(id, memoryOrCall), o, 'before memory changes');
      stmt(
        { op: 'store', width: op === 'i32.store16' ? 16 : 32, addr: a, value: v, offset: o.operands[1] },
        o,
      );
    } else if (op === 'text.checked_address')
      stack.push(val('caddr', [get(o.operands[0], o), get(o.operands[1], o)], undefined, o));
    else if (op === 'array.address') stack.push(val('aaddr', [], o.operands[0], o));
    else if (op === 'array.zero') {
      flush(id => reads(id, memoryOrCall), o, 'before memory changes');
      stmt({ op: 'zero', offset: o.operands[0], bytes: o.operands[1] }, o);
    } else if (op === 'text.literal_stores') {
      // one store16 per UTF-16 unit from address + 4, as the Wasm backend expands it (a checked address precedes)
      const text = f.literals?.[o.operands[1]];
      if (text === undefined)
        throw new LiftError('unsupportedOp', `ingest: ${F} has no literal ${o.operands[1]}`);
      flush(id => reads(id, memoryOrCall), o, 'before memory changes');
      for (let i = 0; i < text.length; i++)
        stmt(
          {
            op: 'store',
            width: 16,
            addr: get(o.operands[0], o),
            value: val('const', [], text.charCodeAt(i), o),
            offset: 4 + 2 * i,
          },
          o,
        );
    } else if (op === 'call') {
      const callee = fe.fns.find(x => x.name === sigName(o.operands[0])) || fe.fns[o.operands[0]];
      const n = callee ? callee.params.length : 0;
      const args = stack.splice(stack.length - n, n);
      flush(id => reads(id, memoryOrCall), o, 'before a call');
      if (callee?.results) {
        // a record result: the call runs as a statement and its leaves are read from it (result k) where they are used
        stmt({ op: 'eval', value: val('call', args, callee.name, o) }, o);
        callee.results.forEach((t, k) => stack.push(val('result', [], k, o, typeClass(t))));
      } else {
        const rt = callee ? typeClass(callee.result) : 'i32';
        const t = newTemp('call result', rt);
        stmt(
          {
            op: 'set',
            local: t,
            value: val('call', args, callee ? callee.name : String(o.operands[0]), o, rt),
          },
          o,
        );
        stack.push(val('get', [], t, o, rt));
      }
    } else if (op === 'drop') stack.pop();
    else if (op === 'block') {
      if (blockResult(o.operands[0]))
        throw new LiftError('unsupportedOp', `ingest: ${F} has a block with a result`);
      flush(() => true, o, 'control');
      ctl.push({ kind: 'block', end: null, height: stack.length });
    } else if (op === 'loop') {
      if (blockResult(o.operands[0]))
        throw new LiftError('unsupportedOp', `ingest: ${F} has a loop with a result`);
      flush(() => true, o, 'control');
      const h = blockOf();
      jump(h, o);
      cur = h;
      ctl.push({ kind: 'loop', head: h, height: stack.length });
    } else if (op === 'if') {
      const c = stack.pop()!;
      flush(() => true, o, 'control');
      const th = blockOf(),
        el = blockOf();
      const resultType = blockResult(o.operands[0]);
      stmt({ op: 'br_if', cond: c, then: th.id, else: el.id }, o);
      cur.succ.push(th.id, el.id);
      cur = th;
      ctl.push({
        kind: 'if',
        elseB: el,
        end: null,
        hasElse: false,
        result: resultType ? newTemp('if result', resultType) : null,
        resultType,
        height: stack.length,
      });
    } else if (op === 'else') {
      const c = ctl.at(-1);
      if (c.result !== null && stack.length > c.height)
        stmt({ op: 'set', local: c.result, value: stack.pop() }, o);
      jump(endOf(c), o);
      c.hasElse = true;
      cur = c.elseB;
    } else if (op === 'end') {
      const c = ctl.pop();
      if (!c) {
        stmt({ op: 'return', value: returned(o) }, o);
        break;
      }
      if (c.kind === 'loop') continue;
      if (c.kind === 'if') {
        if (c.result !== null && stack.length > c.height)
          stmt({ op: 'set', local: c.result, value: stack.pop() }, o);
        const e = endOf(c);
        jump(e, o);
        if (!c.hasElse) {
          cur = c.elseB;
          jump(e, o);
        }
        cur = e;
        if (c.result !== null) stack.push(val('get', [], c.result, o, c.resultType));
        continue;
      }
      if (!c.end) continue; // a block nobody branched to
      jump(c.end, o);
      cur = c.end;
    } else if (op === 'br') {
      const to = target(o.operands[0])!;
      stmt({ op: 'br', to: to.id }, o);
      cur.succ.push(to.id);
      cur = blockOf();
    } else if (op === 'br_if') {
      const cond = stack.pop()!,
        to = target(o.operands[0])!;
      flush(() => true, o, 'control');
      const next = blockOf();
      stmt({ op: 'br_if', cond, then: to.id, else: next.id }, o);
      cur.succ.push(to.id, next.id);
      cur = next;
    } else if (op === 'return') {
      stmt({ op: 'return', value: returned(o) }, o);
      cur = blockOf();
    } else if (op === 'unreachable') {
      stmt({ op: 'trap', why: 'unreachable' }, o);
      cur = blockOf();
    } else
      throw new LiftError(
        'unsupportedOp',
        `ingest: the front end emitted ${op}, which the workbench does not lift yet`,
      );
  }
  prune(store, fn);
  return fn;
}

/** Remove blocks the entry cannot reach (they stay in the store but leave the function). */
export function prune(store: Store, fn: WorkFn): BlockRec[] {
  const reach = new Set<string>(),
    work = [fn.blocks[0].id];
  while (work.length) {
    const id = work.pop()!;
    if (reach.has(id)) continue;
    reach.add(id);
    work.push(...(store.get(id) as BlockRec).succ);
  }
  const gone = fn.blocks.filter(b => !reach.has(b.id));
  fn.blocks = fn.blocks.filter(b => reach.has(b.id));
  return gone;
}

export interface IngestOptions {
  /**
   * Lift from the front end's tape (`frontEndTape`) instead of the Wasm backend's inspection events. Needed for
   * programs whose Wasm encoding cannot be inspected (f32 min/max, conversions); see the module comment.
   */
  readonly tape?: boolean;
  /** With `tape`: lift with source spans and local names (the default), or from the raw tape (`false`). */
  readonly spans?: boolean;
  /** The front end's input limit (default 64 KiB). */
  readonly maxSourceLength?: number;
}

/** Source text -> working store at r0 (front end, then lift every function). Throws LiftError on failure. */
export function ingest(program: string, source: string, options: IngestOptions = {}): Store {
  const fe = options.tape
    ? frontEndTape(source, { maxSourceLength: options.maxSourceLength, spans: options.spans })
    : frontEnd(source, { maxSourceLength: options.maxSourceLength });
  const store = new Store(program, fe.info);
  for (const f of fe.fns) store.fns.set(f.name, lift(store, fe, f));
  return store;
}
