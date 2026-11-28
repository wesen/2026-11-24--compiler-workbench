/**
 * Inlining (IRWB-003, agenda item E3): a call at the root of a statement is replaced by a copy of the callee's
 * body. The callee's locals become new locals of the caller (its parameters are assigned the arguments, and the
 * locals it reads before writing are set to 0, as a fresh frame would hold); the statements after the call move
 * to a continuation block; each `return e` of the copy becomes, by the call's statement:
 *
 *   x = g(…)        x = e; br C
 *   eval g(…)       eval e (if e has an effect); br C — or, for a record result, r_j = e_j for each leaf; br C,
 *                   and the caller's leaf reads of this call (`result#j`) read r_j
 *   return g(…)     return e
 *
 * Callee bodies come from the input revision, so one application inlines one level of calls; the `speed` pipeline applies it
 * twice. A callee is inlined when it is small (`maxSize` statements) or has a single call site in the program
 * (`maxSingle`), and the caller stays under `maxCaller` statements. Recursive callees, callees in a call-graph
 * cycle and callees with a frame array are never inlined.
 *
 * Every entity the pass makes records where it came from: a copy's origin is the callee entity it copies, with the
 * call and its statement in `because`, so `why` reaches both the callee's source and the call's. The pass makes no
 * assumption about the program's entries: under the full contract every function, the callees included, is still
 * compared; with entries, `dfe` afterwards removes the callees that lost their last call.
 *
 * The pass is built by `makeInline(correspond)`, which passes.ts calls with its correspondence function, so this
 * module imports nothing from passes.ts at load time.
 */
import { transformation } from '../framework/passes/transformation.js';
import type { CorrespondenceEntry } from '../framework/ir/types.js';
import type { DataflowResult } from '../framework/dataflow/analysis.js';
import { ANALYSES, hasEffect, liveView, stmtValues } from './analyses.js';
import { BlocksIR, blocksAdapter } from './ir.js';
import {
  Store,
  type BlockRec,
  type StmtRec,
  type TypeClass,
  type TypedBlocks,
  type ValueRec,
  type WorkFn,
} from './model.js';
import { Tx, TxError, type Edit } from './tx.js';
import type { RevisionReport, TypedPass } from './passes.js';

/** The limits of one application, in statements. */
export interface InlineParams {
  /** A callee this small is inlined at every call site. */
  readonly maxSize?: number;
  /** A callee with one call site in the program is inlined when it is at most this large. */
  readonly maxSingle?: number;
  /** No caller grows past this many statements. */
  readonly maxCaller?: number;
}
export const INLINE_DEFAULTS: Required<InlineParams> = Object.freeze({
  maxSize: 16,
  maxSingle: 200,
  maxCaller: 3000,
});

const TERMINATORS = new Set(['br', 'br_if', 'return', 'trap']);
const ABOUT = 'inlining: a call at the root of a statement is replaced by a copy of the callee';

const sizeOf = (f: WorkFn) => f.blocks.reduce((n, b) => n + b.stmts.length, 0);
const callOf = (st: Store, s: StmtRec): ValueRec | null => {
  if (!s.value || (s.op !== 'set' && s.op !== 'eval' && s.op !== 'return')) return null;
  const v = st.get(s.value) as ValueRec;
  return v.op === 'call' ? v : null;
};
const opsIn = (st: Store, id: string | undefined, out: Set<string>): Set<string> => {
  if (!id) return out;
  const v = st.get(id) as ValueRec;
  out.add(v.op);
  v.args.forEach(a => opsIn(st, a, out));
  return out;
};
const readsResult = (st: Store, s: StmtRec) => stmtValues(s).some(v => opsIn(st, v, new Set()).has('result'));

/** Whether every leaf read in `f` follows a multi-result call in its own block, with no other call between. */
function leavesStayPut(st: Store, f: WorkFn): boolean {
  for (const b of f.blocks) {
    let open = false;
    for (const sid of b.stmts) {
      const s = st.get(sid) as StmtRec;
      if (readsResult(st, s) && !open) return false;
      const c = callOf(st, s);
      if (c) open = s.op === 'eval' && !!st.fns.get(c.imm as string)?.results;
      else if (stmtValues(s).some(v => opsIn(st, v, new Set()).has('call'))) open = false;
    }
  }
  return true;
}

/** Functions in a cycle of the call graph (including direct recursion). */
function cyclic(st: Store): Set<string> {
  const edges = new Map<string, Set<string>>();
  for (const f of st.fns.values()) {
    const out = new Set<string>();
    for (const b of f.blocks)
      for (const sid of b.stmts)
        for (const v of stmtValues(st.get(sid) as StmtRec)) {
          const walk = (id: string) => {
            const x = st.get(id) as ValueRec;
            if (x.op === 'call') out.add(x.imm as string);
            x.args.forEach(walk);
          };
          walk(v);
        }
    edges.set(f.name, out);
  }
  const out = new Set<string>();
  for (const start of edges.keys()) {
    const seen = new Set<string>(),
      todo = [...(edges.get(start) ?? [])];
    while (todo.length) {
      const n = todo.pop()!;
      if (n === start) {
        out.add(start);
        break;
      }
      if (seen.has(n)) continue;
      seen.add(n);
      todo.push(...(edges.get(n) ?? []));
    }
  }
  return out;
}

/** Why a callee can never be inlined, or null. */
function refuseCallee(src: Store, g: WorkFn, cycles: Set<string>): string | null {
  if (cycles.has(g.name)) return 'in a call-graph cycle';
  if (g.arrayBytes) return 'has a frame array';
  if (!leavesStayPut(src, g)) return 'reads a record leaf away from its call';
  for (const b of g.blocks)
    for (const sid of b.stmts) {
      const s = src.get(sid) as StmtRec;
      if (s.op === 'zero') return 'zeroes a frame array';
      if (s.op === 'return') {
        const t = s.value && (src.get(s.value) as ValueRec).op === 'tuple';
        if (!!g.results !== !!t) return 'returns a value that is not its declared result';
      }
      for (const v of stmtValues(s))
        if (opsIn(src, v, new Set()).has('aaddr')) return 'addresses a frame array';
    }
  return null;
}

interface Site {
  readonly f: WorkFn;
  readonly B: BlockRec;
  readonly k: number;
  readonly s: StmtRec;
  readonly call: ValueRec;
  readonly g: WorkFn;
}

/** Replace the call of `site` by a copy of the callee's body taken from `src`; returns the statements copied. */
function inlineSite(tx: Tx, st: Store, src: Store, live: DataflowResult, site: Site): number {
  const { f, B, k, s, call, g } = site;
  const because = [call.id, s.id];
  const note = `inlined from ${g.name} into ${f.name} at ${s.id}`;
  const fnG = `fn:${g.name}`;
  const typeOf = (t: string): TypeClass => (t === 'f32' ? 'f32' : 'i32');
  const mark = f.blocks.length;

  // 1. the callee's locals, and one local per leaf of a record result
  const local = g.locals.map(l =>
    tx.local(`${g.name}_${l.name}`, { type: l.type as TypeClass, because: [call.id] }),
  );
  const leaves =
    s.op === 'eval' && g.results
      ? g.results.map((t, j) => tx.local(`${g.name}_r${j}`, { type: t as TypeClass, because: [call.id] }))
      : null;

  // 2. the continuation: the statements after the call, and the block's successors
  const rest = B.stmts.slice(k + 1);
  let C: BlockRec | null = null;
  if (s.op !== 'return') {
    C = st.get(tx.block({ from: B.id, because: [call.id], note: `after the call to ${g.name}` })) as BlockRec;
    C.stmts = rest;
    C.succ = B.succ.slice();
    const last = rest.length ? (st.get(rest.at(-1)!) as StmtRec) : null;
    if (!(last && TERMINATORS.has(last.op)) && B.succ[0])
      C.stmts.push(tx.stmt({ op: 'br', to: B.succ[0] }, { from: B.id, because: [call.id] }));
  }
  B.stmts = B.stmts.slice(0, k);
  tx.record('remove', {
    stmt: s.id,
    block: B.id,
    because: [call.id, fnG],
    note: `the call to ${g.name}, inlined`,
  });

  // 3. enter: the arguments into the parameters, the locals read before written to 0
  call.args.forEach((a, i) =>
    B.stmts.push(tx.set(local[i], a, { from: call.id, because: [fnG], note: `argument ${i} of ${g.name}` })),
  );
  const entryLive = liveView(live, src, g.name).liveIn(g.blocks[0].id);
  for (const i of [...entryLive].sort((x, y) => x - y)) {
    const l = g.locals[i];
    if (l.param) continue;
    const zero = tx.const(0, {
      from: call.id,
      because: [fnG],
      type: typeOf(l.type),
      note: `${g.name}'s local ${l.name} starts at 0`,
    });
    B.stmts.push(
      tx.set(local[i], zero, {
        from: call.id,
        because: [fnG],
        note: `${g.name}'s local ${l.name} starts at 0`,
      }),
    );
  }

  // 4. copy the blocks, renaming locals and blocks
  const blockMap = new Map<string, string>();
  for (const gb of g.blocks) blockMap.set(gb.id, tx.block({ from: gb.id, because, note }));
  B.stmts.push(
    tx.stmt(
      { op: 'br', to: blockMap.get(g.blocks[0].id)! },
      { from: s.id, because: [fnG], note: `enter the inlined body of ${g.name}` },
    ),
  );
  const copy = (id: string): string => {
    const v = src.get(id) as ValueRec;
    const args = v.args.map(copy);
    return tx.make(v.op, ...args, {
      imm: v.op === 'get' ? local[v.imm as number] : v.imm,
      type: v.type ?? 'i32',
      from: id,
      because,
      note,
    });
  };
  const made = (fields: Partial<StmtRec> & { op: StmtRec['op'] }, from: string) =>
    tx.stmt(fields, { from, because, note });
  let copied = 0;
  for (const gb of g.blocks) {
    const nb = st.get(blockMap.get(gb.id)!) as BlockRec;
    nb.succ = gb.succ.map(t => blockMap.get(t)!);
    for (const sid of gb.stmts) {
      const gs = src.get(sid) as StmtRec;
      copied++;
      switch (gs.op) {
        case 'set':
          nb.stmts.push(made({ op: 'set', local: local[gs.local!], value: copy(gs.value!) }, sid));
          break;
        case 'eval':
          nb.stmts.push(made({ op: 'eval', value: copy(gs.value!) }, sid));
          break;
        case 'store':
          nb.stmts.push(
            made(
              {
                op: 'store',
                addr: copy(gs.addr!),
                value: copy(gs.value!),
                width: gs.width,
                offset: gs.offset,
              },
              sid,
            ),
          );
          break;
        case 'br':
          nb.stmts.push(made({ op: 'br', to: blockMap.get(gs.to!)! }, sid));
          break;
        case 'br_if':
          nb.stmts.push(
            made(
              {
                op: 'br_if',
                cond: copy(gs.cond!),
                then: blockMap.get(gs.then!)!,
                else: blockMap.get(gs.else!)!,
              },
              sid,
            ),
          );
          break;
        case 'trap':
          nb.stmts.push(made({ op: 'trap', ...(gs.why ? { why: gs.why } : {}) }, sid));
          break;
        case 'return': {
          if (s.op === 'return') {
            nb.stmts.push(made({ op: 'return', ...(gs.value ? { value: copy(gs.value) } : {}) }, sid));
            break;
          }
          if (gs.value) {
            const rv = src.get(gs.value) as ValueRec;
            if (leaves)
              rv.args.forEach((a, j) =>
                nb.stmts.push(made({ op: 'set', local: leaves[j], value: copy(a) }, sid)),
              );
            else if (s.op === 'set')
              nb.stmts.push(made({ op: 'set', local: s.local, value: copy(gs.value) }, sid));
            else if (hasEffect(src, gs.value))
              nb.stmts.push(made({ op: 'eval', value: copy(gs.value) }, sid));
          }
          nb.stmts.push(made({ op: 'br', to: C!.id }, sid));
          break;
        }
        default:
          throw new TxError('unsupported', `inline: ${g.name} has a statement "${gs.op}" (${sid})`);
      }
    }
    const last = nb.stmts.length ? (st.get(nb.stmts.at(-1)!) as StmtRec) : null;
    if (!(last && TERMINATORS.has(last.op)) && nb.succ[0])
      nb.stmts.push(tx.stmt({ op: 'br', to: nb.succ[0] }, { from: gb.id, because, note }));
  }

  // 5. the caller's reads of this call's record leaves read the new locals
  if (leaves && C) {
    const rebuild = (id: string): string => {
      const v = st.get(id) as ValueRec;
      if (v.op === 'result')
        return tx.make('get', { imm: leaves[v.imm as number], from: id, because: [call.id] });
      const args = v.args.map(rebuild);
      if (args.every((a, i) => a === v.args[i])) return id;
      return tx.make(v.op, ...args, {
        imm: v.imm,
        type: v.type ?? 'i32',
        from: id,
        note: 'rebuilt around a changed argument',
      });
    };
    for (const sid of C.stmts) {
      const cs = st.get(sid) as StmtRec;
      for (const field of ['value', 'cond', 'addr'] as const)
        if (cs[field]) {
          const n = rebuild(cs[field]!);
          if (n !== cs[field]) {
            tx.record('replace', { stmt: sid, field, from: cs[field], to: n, because: [call.id] });
            cs[field] = n;
          }
        }
      const c = callOf(st, cs);
      if (c && cs.op === 'eval' && st.fns.get(c.imm as string)?.results) break;
    }
  }

  // 6. the new blocks follow B, in the callee's order, then the continuation
  const added = f.blocks.splice(mark);
  const order = [...g.blocks.map(gb => st.get(blockMap.get(gb.id)!) as BlockRec), ...(C ? [C] : [])];
  if (added.length !== order.length) throw new Error('inline: block bookkeeping');
  f.blocks.splice(f.blocks.indexOf(B) + 1, 0, ...order);
  tx.record('inline', {
    stmt: s.id,
    callee: g.name,
    block: B.id,
    statements: copied,
    because: [call.id, fnG],
  });
  return copied;
}

/** The sites of one caller that the limits and the rules allow, in block and statement order, as they are found. */
function inlineCaller(
  tx: Tx,
  st: Store,
  src: Store,
  live: DataflowResult,
  f: WorkFn,
  ok: (g: string) => boolean,
  sites: ReadonlyMap<string, number>,
  limits: Required<InlineParams>,
): number {
  if (!leavesStayPut(st, f)) return 0;
  let size = sizeOf(f),
    done = 0;
  const work = f.blocks.slice();
  while (work.length) {
    const B = work.shift()!;
    for (let k = 0; k < B.stmts.length; k++) {
      const s = st.get(B.stmts[k]) as StmtRec;
      const call = callOf(st, s);
      if (!call) continue;
      const name = call.imm as string;
      if (name === f.name || !ok(name)) continue;
      const g = src.fn(name);
      const multi = !!g.results;
      if (multi !== (s.op === 'eval')) continue;
      const n = sizeOf(g);
      if (!(n <= limits.maxSize || (sites.get(name) === 1 && n <= limits.maxSingle))) continue;
      if (size + n > limits.maxCaller) continue;
      if (g.locals.filter(l => l.param).length !== call.args.length) continue;
      // the result-leaf rule: reads after a call that is not a record call belong to an earlier call
      if (!multi) {
        let blocked = false;
        for (const sid of B.stmts.slice(k + 1)) {
          const t = st.get(sid) as StmtRec;
          if (readsResult(st, t)) blocked = true;
          const c = callOf(st, t);
          if (blocked || (c && t.op === 'eval' && st.fns.get(c.imm as string)?.results)) break;
        }
        if (blocked) continue;
      }
      const blocksBefore = f.blocks.length;
      size += inlineSite(tx, st, src, live, { f, B, k, s, call, g });
      done++;
      // the continuation (the last block added) holds the rest of B, which may have more calls
      if (s.op !== 'return') {
        const C = f.blocks[f.blocks.indexOf(B) + 1 + g.blocks.length];
        if (!C || f.blocks.length !== blocksBefore + g.blocks.length + 1)
          throw new Error('inline: continuation');
        work.unshift(C);
      }
      break;
    }
  }
  return done;
}

export function makeInline(
  correspond: (before: TypedBlocks, after: TypedBlocks, edits: readonly Edit[]) => CorrespondenceEntry[],
): TypedPass {
  const definition = transformation<TypedBlocks, Record<string, any>, Record<string, unknown>>({
    id: 'typed.inline',
    version: '1',
    description: ABOUT,
    ir: BlocksIR,
    adapter: blocksAdapter,
    needs: { live: ANALYSES.liveness },
    writes: {
      entities: ['local', 'block', 'stmt.*', 'value.*'],
      relations: ['declares', 'contains', 'uses', 'operand', 'reads', 'writes', 'succ', 'jump'],
    },
    relation: 'exact',
    prepare({ before, facts, params }) {
      const limits = { ...INLINE_DEFAULTS, ...((params ?? {}) as InlineParams) };
      const src = Store.from(before.value),
        st = Store.from(before.value);
      const live = facts.live as DataflowResult;
      const cycles = cyclic(src);
      const refused = new Map<string, string | null>();
      const ok = (name: string) => {
        if (!src.fns.has(name)) return false;
        if (!refused.has(name)) refused.set(name, refuseCallee(src, src.fn(name), cycles));
        return refused.get(name) === null;
      };
      const sites = new Map<string, number>();
      for (const f of src.fns.values())
        for (const b of f.blocks)
          for (const sid of b.stmts)
            for (const v of stmtValues(src.get(sid) as StmtRec)) {
              const walk = (id: string) => {
                const x = src.get(id) as ValueRec;
                if (x.op === 'call') sites.set(x.imm as string, (sites.get(x.imm as string) ?? 0) + 1);
                x.args.forEach(walk);
              };
              walk(v);
            }
      const rev = before.value.rev + 1;
      const edits: Edit[] = [],
        touched: string[] = [];
      for (const f of st.fns.values()) {
        const tx = new Tx(st, f, { name: 'inline', writes: ['stmts', 'values', 'locals', 'cfg'] }, rev);
        if (!inlineCaller(tx, st, src, live, f, ok, sites, limits)) continue;
        tx.commit();
        edits.push(...tx.edits);
        touched.push(f.name);
      }
      if (!edits.length) return;
      st.rev = rev;
      const native = st.toNative();
      const kinds = edits.reduce<Record<string, number>>(
        (m, e) => ((m[e.kind] = (m[e.kind] || 0) + 1), m),
        {},
      );
      const report: RevisionReport = { pass: 'inline', rev, edits, fns: touched, kinds };
      return { native, correspondence: correspond(before.value, native, edits), edits: edits.length, report };
    },
  });
  return Object.freeze({
    ...definition,
    typed: {
      name: 'inline',
      about: ABOUT,
      writes: ['stmts', 'values', 'locals', 'cfg'],
      program: true,
      body: () => {
        throw new TxError('unsupported', 'inline works on the whole program');
      },
    },
  }) as TypedPass;
}
