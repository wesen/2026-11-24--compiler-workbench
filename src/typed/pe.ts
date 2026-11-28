/**
 * IRWB-036-F: polyvariant specialization of a function on its static data (design-doc 01 of the ticket).
 *
 * `bindingTimes` is the binding-time analysis: which locals the bindings determine. `pe` rebuilds a function the
 * bindings name as a residual CFG over pairs (original block, static store). Static statements run at
 * specialization time, a branch on a static condition is decided, and dynamic statements are copied with their
 * static subtrees folded. Specialization points (the entry, loop headers and the targets of dynamic branches) are
 * memoized on the static locals live into the block, so a backward jump of the interpreted program to a store
 * already seen closes a residual loop. A size budget stops a specialization that would not close.
 *
 * Specialization keeps the meaning only on inputs that satisfy the bindings; the pass runs under the contract the
 * program's assumptions restrict (`Program.specialize` sets them), like the `specialize` pass.
 */
import type { Artifact } from '../framework/core/types.js';
import { binop, Trap } from './evaluate.js';
import type { BlockRec, StmtRec, Store, ValueRec, WorkFn } from './model.js';
import { PIPELINES, typedPass } from './passes.js';
import { bufferLoad, bufferPromiseBroken, factRef, type Binding, type Bindings } from './specialize.js';
import { TxError } from './tx.js';
import { divide, unfold } from '../stdlib/pe/index.js';

const STATIC_OPS = new Set([
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
]);

/** A static value's kind: an i32 (`n`), or a frame address whose offset is static (`f`; the value is the offset). */
export type Kind = 'n' | 'f';

export interface BindingTimes {
  /** The static locals and their kind: their value at every point is a function of the bindings alone. */
  readonly static: ReadonlyMap<number, Kind>;
  /** Bound integer parameters and their values. */
  readonly scalars: ReadonlyMap<number, number>;
  /** Bound buffer parameters and their cells. */
  readonly buffers: ReadonlyMap<number, readonly number[]>;
}

/** The bindings that name `f` (parameter and buffer forms), by parameter index. */
export function bindingsOf(f: WorkFn, bindings: readonly Binding[]): { b: Binding; param: number }[] {
  const out: { b: Binding; param: number }[] = [];
  for (const b of bindings) {
    if (b.fn !== f.name || !b.param) continue;
    const param = f.locals.findIndex(l => l.param && l.name === b.param);
    if (param < 0) throw new TxError('unknownLocal', `${f.name} has no parameter "${b.param}"`);
    out.push({ b, param });
  }
  return out;
}

/**
 * The binding-time analysis, flow-insensitive. A bound integer parameter is static, an unbound one dynamic. Any
 * other local is static when every assignment of it assigns a static expression of one kind: of kind `n` (its
 * initial zero is an `n` too), or of kind `f` when its initial value is never read (it is not live into the
 * entry, `entryLive`). Static expressions: constants, reads of static locals, i32 operators over `n` operands,
 * loads of a cell (at an `n` position) or of the length of a bound buffer, which are `n`; and frame addresses
 * `aaddr` plus an `n`, which are `f`. Other loads, calls and f32 values are dynamic.
 */
export function bindingTimes(
  st: Store,
  f: WorkFn,
  bindings: readonly Binding[],
  entryLive: ReadonlySet<number> = new Set(f.locals.map((_l, i) => i)),
): BindingTimes {
  const scalars = new Map<number, number>(),
    buffers = new Map<number, readonly number[]>();
  for (const { b, param } of bindingsOf(f, bindings))
    if (b.cells) buffers.set(param, b.cells);
    else scalars.set(param, b.value!);
  const candidates = new Map<number, Kind>();
  f.locals.forEach((l, i) => {
    if (!l.param || scalars.has(i)) candidates.set(i, 'n');
  });
  const sets = new Map<number, string[]>();
  const optimistic = (local: number) => candidates.get(local) ?? 'n';
  for (const blk of f.blocks)
    for (const sid of blk.stmts) {
      const s = st.get(sid) as StmtRec;
      if (s.op !== 'set') continue;
      const local = s.local!;
      const values = sets.get(local) ?? [];
      values.push(s.value!);
      sets.set(local, values);
      if (candidates.has(local) && !entryLive.has(local) && kindOf(st, s.value!, optimistic, buffers) === 'f')
        candidates.set(local, 'f');
    }

  const staticLocals = divide(candidates, (local, kind, bindingOf) =>
    (sets.get(local) ?? []).every(value => kindOf(st, value, bindingOf, buffers) === kind),
  );
  return { static: staticLocals, scalars, buffers };
}

/** The kind of a static expression, or null when it is dynamic. */
function kindOf(
  st: Store,
  id: string,
  bindingOf: (local: number) => Kind | undefined,
  buffers: ReadonlyMap<number, readonly number[]>,
): Kind | null {
  const v = st.get(id) as ValueRec;
  if (v.type) return null;
  if (v.op === 'const') return 'n';
  if (v.op === 'get') return bindingOf(v.imm as number) ?? null;
  if (v.op === 'aaddr') return 'f';
  const at = bufferLoad(st, v, buffers);
  if (at)
    return typeof at.position !== 'string' || kindOf(st, at.position, bindingOf, buffers) === 'n'
      ? 'n'
      : null;
  if (!STATIC_OPS.has(v.op)) return null;
  const ks = v.args.map(a => kindOf(st, a, bindingOf, buffers));
  if (ks.every(k => k === 'n')) return 'n';
  if (v.op === 'add' && ks.includes('f') && ks.includes('n')) return 'f';
  return null;
}

/**
 * The static value of a static expression (a frame address: its offset); throws the evaluator's Trap where the
 * program would trap.
 */
function staticValue(
  st: Store,
  id: string,
  env: ReadonlyMap<number, number>,
  buffers: ReadonlyMap<number, readonly number[]>,
): number {
  const v = st.get(id) as ValueRec;
  if (v.op === 'const') return v.imm as number;
  if (v.op === 'get') return env.get(v.imm as number)!;
  if (v.op === 'aaddr') return v.imm as number;
  const at = bufferLoad(st, v, buffers);
  if (at) {
    const cells = buffers.get(at.param)!;
    if (at.position === null) return cells.length;
    const p = typeof at.position === 'number' ? at.position : staticValue(st, at.position, env, buffers);
    // a checked load traps here; an unchecked one is only reached after the front end's own length check, which
    // the specialization has already decided, so past the end it is not folded (the Trap keeps it residual)
    if (p >>> 0 >= cells.length) throw new Trap('checked address out of range');
    return cells[p];
  }
  if (v.op === 'eqz') return +(staticValue(st, v.args[0], env, buffers) === 0);
  return binop(v.op, staticValue(st, v.args[0], env, buffers), staticValue(st, v.args[1], env, buffers));
}

/**
 * The passes that turn `pe`'s residual code into a loop over scalars (measured on the bytecode VM, see the ticket's
 * report): cfg merges the residual blocks, promote turns the constant-address frame cells into locals, webs splits
 * the reused stack slots, `speed` optimizes, and a second webs and subst round forwards the copies left by the first.
 */
export const RESIDUAL_PIPELINE: readonly string[] = Object.freeze([
  'cfg',
  'promote',
  'webs',
  ...PIPELINES.speed,
  'webs',
  'subst',
  'subst',
  'subst',
  'subst',
  'dce',
  'cfg',
]);

export const pe = typedPass({
  name: 'pe',
  about:
    'polyvariant specialization: a function bound by params.bindings is rebuilt over (block, static store) pairs, with static code run and static branches decided',
  needs: { live: 'liveness', loops: 'loops' },
  writes: ['stmts', 'values', 'cfg'],
  preserves: [],
  body({ st, f, tx, facts, params }) {
    const art = params.bindings as Artifact<Bindings> | undefined;
    if (!art || art.kind !== 'typed.bindings')
      throw new TxError('unsupported', 'pe needs params.bindings: a typed.bindings artifact');
    const mine = bindingsOf(f, art.value.bindings);
    if (!mine.length) return;
    for (const { b, param } of mine)
      if (b.cells) {
        const broken = bufferPromiseBroken(st, f, param);
        if (broken) throw new TxError('unsupported', broken);
      }
    // default budget: the residual code may not be larger than the function it specializes (a host that accepts
    // growth passes a larger one); the bytecode VM's fixtures need 42 and 40 of runVm's 123 statements
    const budget = (params.budget as number | undefined) ?? f.blocks.reduce((n, b) => n + b.stmts.length, 0);
    const live = facts.live!;
    const bt = bindingTimes(st, f, art.value.bindings, live.liveIn(f.blocks[0].id));
    const S = bt.static;
    const bindingOf = (local: number) => S.get(local);
    const because = mine.map(m => factRef(art, m.b));
    const entry = f.blocks[0];
    const heads = new Set<string>([entry.id, ...facts.loops!.map(L => L.head)]);
    const staticLive = (bid: string) => [...live.liveIn(bid)].filter(l => S.has(l)).sort((x, y) => x - y);
    const show = (bid: string, env: ReadonlyMap<number, number>) =>
      staticLive(bid)
        .map(l => `${f.locals[l].name}=${env.get(l)}`)
        .join(' ');

    let emitted = 0;
    const over = () =>
      new TxError(
        'unsupported',
        `pe: ${f.name} needs more than ${budget} residual statements (params.budget) before its static stores repeat`,
      );
    // residual values: a static subtree becomes its constant; frame + constant becomes one frame address
    const residual = (id: string, env: ReadonlyMap<number, number>): string => {
      const v = st.get(id) as ValueRec;
      const kind = kindOf(st, id, bindingOf, bt.buffers);
      if (kind)
        try {
          const k = staticValue(st, id, env, bt.buffers);
          return kind === 'f'
            ? tx.make('aaddr', { imm: k, from: id, because })
            : tx.const(k, { from: id, because });
        } catch (e) {
          if (!(e instanceof Trap)) throw e;
          // it traps at run time; keep the computation (with its static leaves folded) so it still does
        }
      if (v.op === 'get' && S.get(v.imm as number) === 'n')
        return tx.const(env.get(v.imm as number)!, { from: id, because, type: v.type });
      const args = v.args.map(a => residual(a, env));
      if (v.op === 'add') {
        const [x, y] = args.map(a => st.get(a) as ValueRec);
        const fr = x.op === 'aaddr' ? [x, y] : y.op === 'aaddr' ? [y, x] : null;
        if (fr && fr[1].op === 'const' && !fr[1].type)
          return tx.make('aaddr', {
            imm: ((fr[0].imm as number) + (fr[1].imm as number)) | 0,
            from: id,
            because,
          });
      }
      return tx.make(v.op, ...args, { imm: v.imm, from: id, because, type: v.type ?? 'i32' });
    };

    const run = (
      { point: start, env, handle }: { point: string; env: Map<number, number>; handle: string },
      variant: (bid: string, env: Map<number, number>) => string,
    ) => {
      const R = st.get(handle) as BlockRec;
      const emit = (fields: Partial<StmtRec> & { op: StmtRec['op'] }, from: string) => {
        if (++emitted > budget) throw over();
        tx.insert({ block: R, index: R.stmts.length }, tx.stmt(fields, { from, because }), { because });
      };
      let bid: string | undefined = start,
        walked = 0;
      for (;;) {
        // a walk between specialization points that visits more blocks than the function has went around a cycle
        // without a loop header (an irreducible loop): it would not stop
        if (++walked > f.blocks.length)
          throw new TxError(
            'unsupported',
            `pe: ${f.name} has a cycle through ${start} without a loop header`,
          );
        const b = st.get(bid) as BlockRec;
        let next: string | undefined;
        for (const sid of b.stmts) {
          const s = st.get(sid) as StmtRec;
          switch (s.op) {
            case 'set':
              if (S.has(s.local!)) {
                try {
                  env.set(s.local!, staticValue(st, s.value!, env, bt.buffers));
                } catch (e) {
                  if (!(e instanceof Trap)) throw e;
                  emit({ op: 'trap', why: e.trap }, sid);
                  return;
                }
              } else emit({ op: 'set', local: s.local, value: residual(s.value!, env) }, sid);
              break;
            case 'store':
              emit(
                {
                  op: 'store',
                  addr: residual(s.addr!, env),
                  value: residual(s.value!, env),
                  width: s.width,
                  offset: s.offset,
                },
                sid,
              );
              break;
            case 'eval':
              if (!kindOf(st, s.value!, bindingOf, bt.buffers))
                emit({ op: 'eval', value: residual(s.value!, env) }, sid);
              break;
            case 'zero':
              emit({ op: 'zero', offset: s.offset, bytes: s.bytes }, sid);
              break;
            case 'return':
              emit({ op: 'return', value: residual(s.value!, env) }, sid);
              return;
            case 'trap':
              emit({ op: 'trap', ...(s.why ? { why: s.why } : {}) }, sid);
              return;
            case 'br':
              next = s.to;
              break;
            case 'br_if': {
              const c = residual(s.cond!, env),
                cv = st.get(c) as ValueRec;
              if (cv.op === 'const') next = cv.imm ? s.then : s.else;
              else {
                emit({ op: 'br_if', cond: c, then: variant(s.then!, env), else: variant(s.else!, env) }, sid);
                return;
              }
              break;
            }
          }
          if (next) break;
        }
        next ??= b.succ[0];
        if (!next) {
          emit({ op: 'trap', why: `fell off the end of ${b.id}` }, b.id);
          return;
        }
        if (heads.has(next)) {
          emit({ op: 'br', to: variant(next, env) }, b.id);
          return;
        }
        bid = next;
      }
    };

    const env0 = new Map<number, number>();
    for (const l of S.keys()) env0.set(l, bt.scalars.get(l) ?? 0);
    const residualGraph = unfold<string, Map<number, number>, string>(
      {
        project: (bid, env) =>
          staticLive(bid)
            .map(l => env.get(l))
            .join(','),
        allocate: (bid, env) =>
          tx.block({ from: bid, because, note: show(bid, env) || 'no static locals live' }),
        snapshot: env => new Map(env),
        step: run,
        variants: budget,
        onExhaustion: { kind: 'refuse' },
      },
      entry.id,
      env0,
    );
    if (residualGraph.status === 'refused') throw over();
    // the old entry now only jumps to the residual one; every other old block becomes unreachable
    for (const sid of entry.stmts.slice())
      tx.remove(sid, { because, note: 'specialized: see the residual entry' });
    tx.insert(
      { block: entry, index: 0 },
      tx.stmt({ op: 'br', to: residualGraph.entry }, { from: entry.id, because }),
      {
        because,
      },
    );
    tx.record('pe', { fn: f.name, variants: residualGraph.variants, statements: emitted, budget });
  },
});
