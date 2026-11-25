/**
 * Read-only handles on entities, selections over them, and fragments (a port of Compiler Workbench's
 * handles.js). A handle is a guarded proxy over one entity of one program: values, statements, blocks,
 * functions, front-end ops and image instructions. Entities are looked up from the head revision backwards
 * (`Program.lookup`), so a removed statement still has a handle that reads as it was.
 */
import { hasEffect, isPure, readsOf, stmtValues } from '../typed/analyses.js';
import { COMPARE } from '../typed/listing.js';
import type { BlockRec, StmtRec, Store, ValueRec, WorkFn } from '../typed/model.js';
import { didYouMean, fail, guard, guardHooks } from './base.js';

/** What a handle needs from its program: a WbProgram, or a pass's working store (user passes). */
export interface EntityHost {
  readonly id: string;
  readonly rev: number;
  readonly head: Store;
  find(id: string): { entity: any; store: Store; rev: number } | undefined;
  statusOf(id: string): string;
  text(id: string): string;
  lineage(id: string): string[];
  lines(id: string): number[];
  why(id: string): unknown;
  history(id: string): unknown[];
  fact(
    name: string,
    fn?: string,
  ): { id: string; status: string; rev: string; ms: number; visits?: number; value: any };
  listing(fn?: string): string;
  related(id: string): unknown;
}

const KIND_NAME: Record<string, string> = {
  value: 'Value',
  stmt: 'Statement',
  block: 'Block',
  function: 'Function',
  op: 'Op',
  insn: 'Instruction',
};

// ---------- uses: which statement holds each value, and its parent value ----------
const usesCache = new WeakMap<Store, Map<string, { stmt: string; parent: string | null }>>();
export function usesOf(st: Store): Map<string, { stmt: string; parent: string | null }> {
  let map = usesCache.get(st);
  if (map) return map;
  map = new Map();
  const walk = (id: string | undefined, stmt: string, parent: string | null) => {
    if (!id) return;
    map!.set(id, { stmt, parent });
    for (const a of (st.get(id) as ValueRec).args) walk(a, stmt, id);
  };
  for (const f of st.fns.values())
    for (const b of f.blocks)
      for (const sid of b.stmts) {
        const s = st.get(sid) as StmtRec;
        for (const k of ['value', 'cond', 'addr'] as const) walk(s[k], sid, null);
      }
  usesCache.set(st, map);
  return map;
}
function blockOf(st: Store, sid: string): string | null {
  for (const f of st.fns.values()) for (const b of f.blocks) if (b.stmts.includes(sid)) return b.id;
  return null;
}
const sameTree = (st: Store, a: string, b: string): boolean => {
  const x = st.get(a) as ValueRec,
    y = st.get(b) as ValueRec;
  return (
    !!x &&
    !!y &&
    x.op === y.op &&
    x.imm === y.imm &&
    x.args.length === y.args.length &&
    x.args.every((u, i) => sameTree(st, u, y.args[i]))
  );
};
const valueTree = (st: Store, roots: readonly string[]): string[] => {
  const out: string[] = [];
  const w = (v: string | undefined) => {
    if (!v) return;
    out.push(v);
    (st.get(v) as ValueRec).args.forEach(w);
  };
  roots.forEach(w);
  return out;
};

// ---------- fragments: members added to a kind of handle (wb.fragment) ----------
interface FragmentMember {
  readonly kind: string;
  readonly member: string;
  readonly type: 'attr' | 'method';
  readonly fn: (h: any, ...args: any[]) => unknown;
}
export class Fragments {
  private readonly all = new Map<string, { name: string; members: FragmentMember[] }>();
  private readonly used = new Set<string>();
  define(name: string) {
    const frag = { name, members: [] as FragmentMember[] };
    let kind: string | null = null;
    const b: any = guard('FragmentBuilder', {
      on(k: string) {
        kind =
          {
            Value: 'value',
            Statement: 'stmt',
            Block: 'block',
            Function: 'function',
            Op: 'op',
            Instruction: 'insn',
          }[k] ?? k;
        return b;
      },
      attr(member: string, fn: FragmentMember['fn']) {
        if (!kind) fail('incomplete', 'fragment: call .on(kind) before .attr');
        frag.members.push({ kind: kind!, member, type: 'attr', fn });
        return b;
      },
      method(member: string, fn: FragmentMember['fn']) {
        if (!kind) fail('incomplete', 'fragment: call .on(kind) before .method');
        frag.members.push({ kind: kind!, member, type: 'method', fn });
        return b;
      },
      get name() {
        return name;
      },
      get members() {
        return frag.members.map(m => `${m.kind}.${m.member} (${m.type})`);
      },
      _frag: frag,
    });
    this.all.set(name, frag);
    return b;
  }
  use(x: string | { _frag?: { name: string } }): string {
    const frag = typeof x === 'string' ? this.all.get(x) : this.all.get(x._frag?.name ?? '');
    if (!frag)
      fail('unknownFragment', `no fragment "${typeof x === 'string' ? x : '?'}"`, {
        fix: `fragments: ${[...this.all.keys()].join(', ') || 'none yet'}`,
      });
    for (const m of frag!.members)
      for (const other of this.used) {
        const o = this.all.get(other)!;
        if (o !== frag && o.members.some(y => y.kind === m.kind && y.member === m.member))
          fail('fragmentConflict', `${m.kind}.${m.member} is defined by "${o.name}" and "${frag!.name}"`, {
            fix: `remove one: wb.drop('${o.name}')`,
          });
      }
    this.used.add(frag!.name);
    return frag!.name;
  }
  drop(name: string): void {
    this.used.delete(name);
  }
  list() {
    return [...this.all.values()].map(f => ({
      name: f.name,
      used: this.used.has(f.name),
      members: f.members.map(m => `${m.kind}.${m.member}`),
    }));
  }
  get(name: string) {
    return this.all.get(name);
  }
  provider(kindName: string, member: string): string | null {
    const kind = Object.entries(KIND_NAME).find(([, v]) => v === kindName)?.[0];
    for (const f of this.all.values())
      if (!this.used.has(f.name) && f.members.some(m => m.member === member && (!kind || m.kind === kind)))
        return f.name;
    return null;
  }
  decorate(kind: string, h: any): void {
    for (const name of this.used)
      for (const m of this.all.get(name)!.members)
        if (m.kind === kind) {
          if (m.type === 'attr') Object.defineProperty(h, m.member, { get: () => m.fn(h), enumerable: true });
          else h[m.member] = (...args: unknown[]) => m.fn(h, ...args);
        }
  }
}
export const fragments = new Fragments();
guardHooks.provider = (kind, member) => fragments.provider(kind, member);

// ---------- handles ----------
/** A handle on entity `id` of program `p`; `ctx.stmt` is the statement a value was reached through. */
export function handle(p: EntityHost, id: string, ctx: { stmt?: string } = {}): any {
  const found = p.find(id);
  if (!found)
    fail('absent', `${id} does not exist in ${p.id}`, {
      fix: 'ids look like fn:name, bb:name.3, s:name.7, v:name.12, op:name#5, insn:name+0x1c',
    });
  const { entity: e, store: st } = found!;
  const h: any = { id, kind: e.kind, _ent: e, _p: p, _key: `${p.id}/${id}` };
  const common = {
    get status() {
      return p.statusOf(id);
    },
    get text() {
      return p.text(id);
    },
    describe() {
      return describe(p, id);
    },
    origin() {
      return (e.origin || []).map((o: object) => ({ ...o }));
    },
    lineage() {
      return p.lineage(id);
    },
    lines() {
      return p.lines(id);
    },
    why() {
      return p.why(id);
    },
    history() {
      return p.history(id);
    },
    _describe() {
      return describe(p, id);
    },
  };
  Object.defineProperties(h, Object.getOwnPropertyDescriptors(common));
  if (e.kind === 'value') {
    const v = e as ValueRec;
    Object.defineProperties(
      h,
      Object.getOwnPropertyDescriptors({
        op: v.op,
        imm: v.imm,
        get args() {
          return v.args.map(a => handle(p, a, ctx));
        },
        get isConst() {
          return v.op === 'const';
        },
        get isLeaf() {
          return !v.args.length;
        },
        get isPure() {
          return isPure(st, id);
        },
        get hasEffect() {
          return hasEffect(st, id);
        },
        get isBoolean() {
          return COMPARE.has(v.op);
        },
        get reads() {
          const f = st.get(v.fn) as WorkFn;
          return [...readsOf(st, id)].map(l => f.locals[l].name);
        },
        get statement() {
          return ctx.stmt || usesOf(st).get(id)?.stmt || null;
        },
        get parent() {
          return usesOf(st).get(id)?.parent || null;
        },
        same(other: string | { id: string }) {
          return sameTree(st, id, typeof other === 'string' ? other : other.id);
        },
        size() {
          const n = (x: string): number => 1 + (st.get(x) as ValueRec).args.reduce((s, a) => s + n(a), 0);
          return n(id);
        },
      }),
    );
  } else if (e.kind === 'stmt') {
    const s = e as StmtRec,
      f = st.get(s.fn) as WorkFn;
    Object.defineProperties(
      h,
      Object.getOwnPropertyDescriptors({
        op: s.op,
        local: s.local,
        to: s.to,
        then: s.then,
        else: s.else,
        width: s.width,
        offset: s.offset,
        get localName() {
          return s.local !== undefined ? f.locals[s.local].name : null;
        },
        get value() {
          return s.value ? handle(p, s.value, { stmt: id }) : null;
        },
        get cond() {
          return s.cond ? handle(p, s.cond, { stmt: id }) : null;
        },
        get addr() {
          return s.addr ? handle(p, s.addr, { stmt: id }) : null;
        },
        get block() {
          return blockOf(st, id);
        },
        values() {
          return selection(p, `stmt('${id}').values()`, () => valueTree(st, stmtValues(s)));
        },
      }),
    );
  } else if (e.kind === 'block') {
    const b = e as BlockRec;
    Object.defineProperties(
      h,
      Object.getOwnPropertyDescriptors({
        get succ() {
          return b.succ.slice();
        },
        preds() {
          const f = st.get(b.fn) as WorkFn;
          return f.blocks.filter(x => x.succ.includes(id)).map(x => x.id);
        },
        stmts() {
          return selection(p, `block('${id}').stmts()`, () => b.stmts.slice());
        },
        defs() {
          return new Set(
            b.stmts
              .map(x => st.get(x) as StmtRec)
              .filter(x => x.op === 'set')
              .map(x => x.local!),
          );
        },
        uses() {
          const u = new Set<number>(),
            d = new Set<number>();
          for (const sid of b.stmts) {
            const x = st.get(sid) as StmtRec;
            for (const v of stmtValues(x)) for (const l of readsOf(st, v)) if (!d.has(l)) u.add(l);
            if (x.op === 'set') d.add(x.local!);
          }
          return u;
        },
      }),
    );
  } else if (e.kind === 'function') {
    const f = e as WorkFn;
    Object.defineProperties(
      h,
      Object.getOwnPropertyDescriptors({
        name: f.name,
        params: f.params.slice(),
        result: f.result,
        blocks() {
          return selection(p, `fn('${f.name}').blocks()`, () => f.blocks.map(b => b.id));
        },
        stmts() {
          return selection(p, `fn('${f.name}').stmts()`, () => f.blocks.flatMap(b => b.stmts));
        },
        values() {
          return selection(p, `fn('${f.name}').values()`, () =>
            valueTree(
              st,
              f.blocks.flatMap(b => b.stmts.flatMap(sid => stmtValues(st.get(sid) as StmtRec))),
            ),
          );
        },
        ops() {
          return selection(p, `fn('${f.name}').ops()`, () =>
            [...st.ents.values()].filter(x => x.kind === 'op' && x.fn === id).map(x => x.id),
          );
        },
        locals() {
          return f.locals.map(l => ({ id: `local:${f.name}/${l.name}`, ...l }));
        },
        loops() {
          return (p.fact('loops', f.name).value as object[]).map(l => ({ ...l }));
        },
        fact(name: string) {
          const x = p.fact(name, f.name);
          return { id: x.id, status: x.status, rev: x.rev, ms: x.ms, visits: x.visits, value: x.value };
        },
        listing() {
          return p.listing(f.name);
        },
      }),
    );
  } else if (e.kind === 'op') {
    Object.defineProperties(
      h,
      Object.getOwnPropertyDescriptors({
        op: e.op,
        operands: e.operands,
        line: e.at && e.at.line,
        col: e.at && e.at.col,
        get derived() {
          return p.related(id);
        },
      }),
    );
  } else if (e.kind === 'insn') {
    Object.defineProperties(
      h,
      Object.getOwnPropertyDescriptors({
        offset: e.offset,
        word: e.word,
        text: e.text,
        sym: e.sym,
        fn: e.fn,
        image: e.image,
        why: e.why,
        covers: e.covers,
      }),
    );
  }
  fragments.decorate(e.kind, h);
  return guard(KIND_NAME[e.kind] ?? e.kind, h);
}

export function describe(p: EntityHost, id: string): Record<string, unknown> {
  const e = p.find(id)!.entity;
  const out: Record<string, unknown> = { id, kind: e.kind, what: p.text(id), status: p.statusOf(id) };
  if (e.fn) out.fn = e.fn;
  if (e.kind === 'value' || e.kind === 'stmt') {
    const lines = p.lines(id);
    if (lines.length) out.lines = lines;
  }
  if (e.kind === 'value') {
    const u = usesOf(p.head).get(id);
    if (u) out.in = u.stmt;
  }
  if (e.kind === 'op' && e.at) {
    out.line = e.at.line;
    out.col = e.at.col;
  }
  if (e.origin && e.origin.length)
    out.origin = e.origin.map(
      (o: any) =>
        `${o.via}${o.rev !== undefined ? '@r' + o.rev : ''} from ${o.from}${o.because && o.because.length ? ' because ' + o.because.join(', ') : ''}${o.note ? ' (' + o.note + ')' : ''}`,
    );
  return out;
}

// ---------- selections ----------
export function selection(p: EntityHost, of: string, produce: () => string[]): any {
  const s = {
    of,
    where(fn: (h: any) => unknown) {
      return selection(p, `${of}.where(${fn.toString().slice(0, 60)})`, () =>
        produce().filter(id => fn(handle(p, id))),
      );
    },
    line(n: number) {
      return selection(p, `${of}.line(${n})`, () =>
        produce().filter(id => p.lines(id).includes(n) || p.find(id)?.entity.at?.line === n),
      );
    },
    op(name: string) {
      return selection(p, `${of}.op('${name}')`, () =>
        produce().filter(id => p.find(id)?.entity.op === name),
      );
    },
    take(n: number) {
      return selection(p, `${of}.take(${n})`, () => produce().slice(0, n));
    },
    ids() {
      return produce();
    },
    list() {
      return produce().map(id => handle(p, id));
    },
    first() {
      const id = produce()[0];
      return id ? handle(p, id) : null;
    },
    count() {
      return produce().length;
    },
    map(fn: (h: any) => unknown) {
      return produce().map(id => fn(handle(p, id)));
    },
    sum(fn: (h: any) => number) {
      return produce().reduce((n, id) => n + fn(handle(p, id)), 0);
    },
    table(...cols: (string | ((h: any) => unknown))[]) {
      if (!cols.length) cols = ['id', 'text'];
      return produce().map(id => {
        const h = handle(p, id),
          row: Record<string, unknown> = {};
        for (const c of cols)
          row[typeof c === 'function' ? c.name || 'value' : c] = typeof c === 'function' ? c(h) : h[c];
        return row;
      });
    },
    result() {
      const ids = produce();
      return {
        kind: 'count',
        value: ids.length,
        of,
        status: 'known',
        rev: `r${p.rev}`,
        witnesses: ids.slice(0, 12),
      };
    },
    _describe() {
      const ids = produce();
      return { of, count: ids.length, ids: ids.slice(0, 20).map(id => `${id}  ${p.text(id)}`) };
    },
  };
  return guard('Selection', s);
}

export { didYouMean };
