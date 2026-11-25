/**
 * The front end (reused unchanged from ds-js-os) and lifting: stack code with structured control into a CFG of
 * statements over value trees. A port of Compiler Workbench's store.js `frontEnd`, `lift` and `prune`; the
 * algorithms are the prototype's, written against the typed working store.
 *
 * Values are trees; a value has one user. The operand stack is materialized into temporaries wherever evaluation
 * order could change: before a local it reads is assigned, before memory changes, before a call, around control.
 */
import { requireVendor } from './vendor.js';
import {
  Store,
  type BlockRec,
  type FrontEndInfo,
  type Origin,
  type SourcePos,
  type StmtRec,
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

export class LiftError extends Error {
  constructor(
    readonly code: 'frontEndError' | 'unsupportedOp',
    message: string,
    readonly at?: { line: number; col: number },
  ) {
    super(message);
    this.name = 'LiftError';
  }
}

export interface FrontEndFn {
  name: string;
  params: string[];
  result: string;
  localCount: number;
  locals: {
    index: number;
    name: string;
    type: string;
    mutable: boolean;
    param: boolean;
    at: SourcePos | null;
  }[];
  ops: { ordinal: number; op: string; operands: number[]; at: SourcePos | null }[];
}
export interface FrontEnd {
  fns: FrontEndFn[];
  info: FrontEndInfo;
}

/** Run the reused front end with its inspection callback: per function, locals and ops with source spans. */
export function frontEnd(source: string): FrontEnd {
  const typedWasm = requireVendor('typedWasm');
  const events: any[] = [];
  let out: any;
  try {
    out = typedWasm.compile(source, { inspect: { emit: (e: unknown) => events.push(e) } });
  } catch (e) {
    const m = /^(\d+):(\d+): (.*)$/s.exec((e as Error).message);
    throw new LiftError(
      'frontEndError',
      m ? m[3] : (e as Error).message,
      m ? { line: +m[1], col: +m[2] } : undefined,
    );
  }
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  const pos = (off: number): SourcePos => {
    let lo = 0,
      hi = starts.length;
    while (lo + 1 < hi) {
      const m = (lo + hi) >> 1;
      if (starts[m] <= off) lo = m;
      else hi = m;
    }
    return { line: lo + 1, col: off - starts[lo] + 1 };
  };
  const fns: FrontEndFn[] = events
    .filter(e => e.kind === 'frontend')
    .map(f => ({
      name: f.function,
      params: f.params,
      result: f.result,
      localCount: f.localCount,
      locals: f.locals.map((l: any) => ({
        index: l.index,
        name: l.name,
        type: l.type,
        mutable: l.mutable,
        param: l.parameter,
        at: l.source ? pos(l.source.start) : null,
      })),
      ops: f.operations.map((o: any) => ({
        ordinal: o.ordinal,
        op: o.op,
        operands: o.operands,
        at: o.source ? { ...pos(o.source.start), start: o.source.start, end: o.source.end } : null,
      })),
    }));
  const json = (x: unknown) => (x === undefined ? null : JSON.parse(JSON.stringify(x)));
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

const TERMINATORS = new Set(['br', 'br_if', 'return', 'trap']);

export function lift(store: Store, fe: FrontEnd, f: FrontEndFn): WorkFn {
  const F = f.name;
  const fn: WorkFn = {
    id: `fn:${F}`,
    kind: 'function',
    name: F,
    params: f.params.slice(),
    result: f.result,
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
          : { index: k, name: `t${k}`, type: 'i32', param: false, mutable: true, temp: 'front end' },
      );
    }
  };
  ensureLocal(f.localCount - 1);
  const newTemp = (why: string) => {
    const k = fn.locals.length;
    fn.locals.push({ index: k, name: `t${k}`, type: 'i32', param: false, mutable: true, temp: why });
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
  const val = (op: ValueOp, args: string[], imm: number | string | undefined, o: { ordinal: number }) =>
    store.add<ValueRec>({
      id: store.fresh(`v:${F}`),
      kind: 'value',
      fn: fn.id,
      op,
      args,
      ...(imm === undefined ? {} : { imm }),
      origin: origin(o),
    }).id;
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
  const stack: string[] = [],
    ctl: any[] = [];
  const flush = (pred: (id: string) => boolean, o: { ordinal: number }, why: string) => {
    for (let i = 0; i < stack.length; i++) {
      const v = store.get(stack[i]) as ValueRec;
      if (v.op === 'const' || (v.op === 'get' && why === 'control') || !pred(stack[i])) continue;
      const t = newTemp(why);
      stmt({ op: 'set', local: t, value: stack[i] }, o, `stack value kept in t${t} (${why})`);
      stack[i] = val('get', [], t, o);
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
  const sigName = (i: number) => (fe.info.signatures as any)?.[i]?.name;
  for (const o of f.ops) {
    const opId = `op:${F}#${o.ordinal}`;
    if (!store.has(opId))
      store.add({ id: opId, kind: 'op', fn: fn.id, op: o.op, operands: o.operands, at: o.at });
    const op = o.op;
    if (op === 'i32.const') stack.push(val('const', [], o.operands[0] | 0, o));
    else if (op === 'local.get') {
      ensureLocal(o.operands[0]);
      stack.push(val('get', [], o.operands[0], o));
    } else if (op === 'local.set') {
      const L = o.operands[0];
      ensureLocal(L);
      const v = stack.pop()!;
      flush(id => reads(id, x => x.op === 'get' && x.imm === L), o, `before ${fn.locals[L].name} changes`);
      stmt({ op: 'set', local: L, value: v }, o);
    } else if (BINOPS[op]) {
      const b = stack.pop()!,
        a = stack.pop()!;
      stack.push(val(BINOPS[op], [a, b], undefined, o));
    } else if (op === 'i32.eqz') stack.push(val('eqz', [stack.pop()!], undefined, o));
    else if (op === 'i32.load' || op === 'i32.load16_u')
      stack.push(val(op === 'i32.load' ? 'load' : 'load16u', [stack.pop()!], o.operands[1], o));
    else if (op === 'i32.store' || op === 'i32.store16') {
      const v = stack.pop()!,
        a = stack.pop()!;
      flush(
        id => reads(id, x => x.op === 'load' || x.op === 'load16u' || x.op === 'call'),
        o,
        'before memory changes',
      );
      stmt({ op: 'store', width: op === 'i32.store' ? 32 : 16, addr: a, value: v, offset: o.operands[1] }, o);
    } else if (op === 'call') {
      const callee = fe.fns.find(x => x.name === sigName(o.operands[0])) || fe.fns[o.operands[0]];
      const n = callee ? callee.params.length : 0;
      const args = stack.splice(stack.length - n, n);
      flush(
        id => reads(id, x => x.op === 'load' || x.op === 'load16u' || x.op === 'call'),
        o,
        'before a call',
      );
      const t = newTemp('call result');
      stmt(
        { op: 'set', local: t, value: val('call', args, callee ? callee.name : String(o.operands[0]), o) },
        o,
      );
      stack.push(val('get', [], t, o));
    } else if (op === 'drop') stack.pop();
    else if (op === 'block') {
      flush(() => true, o, 'control');
      ctl.push({ kind: 'block', end: null, height: stack.length });
    } else if (op === 'loop') {
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
      const hasResult = o.operands[0] === 0x7f;
      stmt({ op: 'br_if', cond: c, then: th.id, else: el.id }, o);
      cur.succ.push(th.id, el.id);
      cur = th;
      ctl.push({
        kind: 'if',
        elseB: el,
        end: null,
        hasElse: false,
        result: hasResult ? newTemp('if result') : null,
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
        stmt({ op: 'return', value: stack.length ? stack.pop()! : val('const', [], 0, o) }, o);
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
        if (c.result !== null) stack.push(val('get', [], c.result, o));
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
      stmt({ op: 'return', value: stack.length ? stack.pop()! : val('const', [], 0, o) }, o);
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

/** Source text -> working store at r0 (front end, then lift every function). Throws LiftError on failure. */
export function ingest(program: string, source: string): Store {
  const fe = frontEnd(source);
  const store = new Store(program, fe.info);
  for (const f of fe.fns) store.fns.set(f.name, lift(store, fe, f));
  return store;
}
