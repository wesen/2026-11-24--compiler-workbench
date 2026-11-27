/**
 * Specialization on a constant buffer (IRWB-036-G): a first Futamura projection for interpreters written in Typed.
 *
 * A host binds a buffer parameter to fixed cells (`Binding.cells`) and may bind a scalar parameter to candidate
 * values (`Binding.oneOf`). The binding-time analysis (bta.ts) says which locals are then static. This pass makes
 * variants of the function's blocks, one per state `(block, values of the static locals live into it)`:
 *
 *   - a static read becomes its constant, a static load from the buffer its cell, a static subtree its value;
 *   - a branch on a static condition becomes a jump to the variant of the taken successor; a dynamic branch keeps
 *     both successors, each as its own variant;
 *   - every assignment is still emitted, so at every point of a variant the locals and the frame hold what the
 *     original program holds there, and any original block is a valid continuation.
 *
 * States are memoized, which turns the interpreted program's back edges into residual back edges. The number of
 * variants is bounded by `budget`; a jump to a state that would exceed it goes to the original block. When the
 * budget suffices, the original blocks are unreachable and `commit` prunes them.
 *
 * The promise is checked as a field binding is: the pass refuses a function that could write the buffer (a call,
 * or a store whose address is not in its own frame array area), and `Program.specializeBuffer` restricts the
 * meaning contract to inputs that satisfy the bindings. With `guard: true` the promise is checked at run time
 * instead: the new entry compares the buffer's length and the cells the variants read with the bound ones and
 * runs the original code when they differ, so nothing is assumed.
 */
import type { Artifact } from '../framework/core/types.js';
import { binop } from './evaluate.js';
import { bindingTimes, bufferLoadOf, STATIC_BINARY } from './bta.js';
import type { BlockRec, StmtRec, Store, ValueRec, WorkFn } from './model.js';
import { typedPass } from './passes.js';
import { BindingsIR, factRef, type Binding, type Bindings } from './specialize.js';
import { TxError } from './tx.js';

/**
 * The default budget is this many variants per bound cell. A variant is one residual program point. For an
 * interpreter whose static state is the position in the buffer, a position has at most one variant at the loop
 * head and one per arm of a dynamic two-way branch (3); 4 leaves room for one more static local with two values at
 * a position. The measured need for the corpus VM is in the IRWB-036-G report.
 */
export const BUDGET_PER_CELL = 4;

/** Whether an address is inside the function's own frame array area (given the locals that hold such addresses). */
function frameRooted(st: Store, id: string, frameLocals: ReadonlySet<number>): boolean {
  const v = st.get(id) as ValueRec;
  if (v.op === 'aaddr') return true;
  if (v.op === 'get') return frameLocals.has(v.imm as number);
  if (v.op === 'add')
    return frameRooted(st, v.args[0], frameLocals) !== frameRooted(st, v.args[1], frameLocals);
  return false;
}

/**
 * Refuse a function that could change a bound buffer: it calls something, assigns the buffer parameter, or stores
 * through an address that is not rooted in its frame array area (whose indices the front end bounds-checks).
 */
function refuseWrites(st: Store, f: WorkFn, buffers: ReadonlyMap<number, Binding>): void {
  const sets: StmtRec[] = [],
    stores: StmtRec[] = [];
  const noCall = (id: string | undefined, sid: string): void => {
    if (!id) return;
    const v = st.get(id) as ValueRec;
    if (v.op === 'call')
      throw new TxError(
        'unsupported',
        `${f.name} calls ${v.imm} (${sid}); the callee could write the bound buffer`,
      );
    v.args.forEach(a => noCall(a, sid));
  };
  for (const b of f.blocks)
    for (const sid of b.stmts) {
      const s = st.get(sid) as StmtRec;
      (noCall(s.value, sid), noCall(s.cond, sid), noCall(s.addr, sid));
      if (s.op === 'set') sets.push(s);
      if (s.op === 'store') stores.push(s);
    }
  for (const s of sets)
    if (buffers.has(s.local!))
      throw new TxError(
        'unsupported',
        `${f.name} assigns ${f.locals[s.local!].name} (${s.id}); the binding cannot hold`,
      );
  // locals that only ever hold frame addresses (greatest fixpoint, as in the binding-time analysis)
  const frameLocals = new Set(f.locals.filter(l => !l.param).map(l => l.index));
  for (let changed = true; changed; ) {
    changed = false;
    for (const s of sets)
      if (frameLocals.has(s.local!) && !frameRooted(st, s.value!, frameLocals)) {
        frameLocals.delete(s.local!);
        changed = true;
      }
  }
  for (const s of stores)
    if (!frameRooted(st, s.addr!, frameLocals))
      throw new TxError(
        'unsupported',
        `${f.name} stores outside its frame (${s.id}); the store could write the bound buffer`,
      );
}

export const specializeBuffer = typedPass({
  name: 'specialize-buffer',
  about:
    'specialization on a constant buffer: block variants per value of the static locals, loads from the buffer folded',
  needs: { live: 'liveness', loops: 'loops' },
  writes: ['values', 'stmts', 'cfg'],
  preserves: [],
  body({ st, f, tx, facts, params }) {
    const art = params.bindings as Artifact<Bindings> | undefined;
    if (!art || art.kind !== BindingsIR.id)
      throw new TxError('unsupported', 'specialize-buffer needs params.bindings: a typed.bindings artifact');
    const guard = params.guard === true;
    const live = facts.live!;

    // ---- the bindings of this function
    const buffers = new Map<number, Binding>();
    let candidate: { index: number; binding: Binding } | undefined;
    for (const b of art.value.bindings) {
      if (b.fn !== f.name || (!b.cells && !b.oneOf)) continue;
      const i = f.locals.findIndex(l => l.param && l.name === b.param);
      if (i < 0) throw new TxError('unknownLocal', `${f.name} has no parameter "${b.param}"`);
      if (b.cells) {
        if (f.params[i] !== 'buffer')
          throw new TxError(
            'unsupported',
            `${f.name}.${b.param} is a ${f.params[i]}; bind cells to a buffer`,
          );
        buffers.set(i, b);
      } else {
        if (candidate)
          throw new TxError('unsupported', `${f.name} has two candidate bindings; bind one parameter`);
        candidate = { index: i, binding: b };
      }
    }
    if (!buffers.size) return;
    const bound = [...buffers.values()].reduce((n, b) => n + b.cells!.length, 0);
    const budget = (params.budget as number | undefined) ?? BUDGET_PER_CELL * bound;
    refuseWrites(st, f, buffers);

    const division = bindingTimes(
      st,
      f,
      new Set(buffers.keys()),
      new Set(candidate ? [candidate.index] : []),
    );
    const bufferSet = new Set(buffers.keys());
    const facts_ = [...buffers.values()].map(b => factRef(art, b));
    /** Cells the variants replaced by constants, per buffer parameter (what a guard has to compare). */
    const cellsRead = new Map<number, Set<number>>();
    const lengthRead = new Set<number>();

    // ---- evaluation and copying under an environment (static local -> value)
    type Env = Map<number, number>;
    const ev = (id: string, env: Env, touch: boolean): number | undefined => {
      const v = st.get(id) as ValueRec;
      if (v.type === 'f32') return undefined;
      if (v.op === 'const') return v.imm as number;
      if (v.op === 'get') return env.get(v.imm as number);
      if (STATIC_BINARY.has(v.op)) {
        const a = ev(v.args[0], env, touch),
          b = ev(v.args[1], env, touch);
        return a === undefined || b === undefined ? undefined : binop(v.op, a, b);
      }
      if (v.op === 'eqz') {
        const a = ev(v.args[0], env, touch);
        return a === undefined ? undefined : +(a === 0);
      }
      const load = bufferLoadOf(st, id, bufferSet);
      if (!load) return undefined;
      const cells = buffers.get(load.param)!.cells!;
      if (load.kind === 'length') {
        if (touch) lengthRead.add(load.param);
        return cells.length;
      }
      const at = ev(load.position!, env, touch);
      // an index outside the buffer traps in caddr: the load is kept and traps as it did
      if (at === undefined || at < 0 || at >= cells.length) return undefined;
      if (touch) {
        lengthRead.add(load.param);
        let seen = cellsRead.get(load.param);
        if (!seen) cellsRead.set(load.param, (seen = new Set()));
        seen.add(at);
      }
      return cells[at];
    };
    const copy = (id: string, env: Env): string => {
      const v = st.get(id) as ValueRec;
      if (v.op !== 'const') {
        const known = ev(id, env, true);
        if (known !== undefined)
          return tx.const(known, { from: id, because: facts_, note: `static under ${describe(env)}` });
      }
      return tx.make(v.op, ...v.args.map(a => copy(a, env)), {
        imm: v.imm,
        from: id,
        type: v.type ?? 'i32',
      });
    };
    const describe = (env: Env) =>
      [...env]
        .sort(([a], [b]) => a - b)
        .map(([l, n]) => `${f.locals[l].name}=${n}`)
        .join(' ') || 'no static locals';

    // ---- variants, memoized on the live static locals
    const variants = new Map<string, string>();
    const work: { from: BlockRec; to: BlockRec; env: Env }[] = [];
    let overBudget = 0;
    const loopHeads = new Set(facts.loops!.map(L => L.head));
    const keyOf = (target: string, env: Env): [string, Env] => {
      const liveIn = live.liveIn(target);
      const kept: Env = new Map([...env].filter(([l]) => liveIn.has(l)).sort(([a], [b]) => a - b));
      return [`${target}|${[...kept].map(([l, n]) => `${l}=${n}`).join(',')}`, kept];
    };
    const variant = (target: string, env: Env): string => {
      const [key, kept] = keyOf(target, env);
      const have = variants.get(key);
      if (have) return have;
      if (variants.size >= budget) {
        overBudget++;
        return target;
      }
      const from = st.get(target) as BlockRec;
      const id = tx.block({ from: target, because: facts_, note: `variant for ${describe(kept)}` });
      variants.set(key, id);
      work.push({ from, to: st.get(id) as BlockRec, env: kept });
      return id;
    };
    const emit = (to: BlockRec, fields: Partial<StmtRec> & { op: StmtRec['op'] }, from: string): void => {
      to.stmts.push(tx.stmt(fields, { from, because: facts_ }));
    };
    /**
     * Fill one variant. A jump whose target is decided (a `br`, or a `br_if` on a static condition) is compressed:
     * the target's statements continue in the same variant, unless the target already has a variant for this
     * state, is the head of a loop of the original function, or was already copied into this variant. The last two
     * make every cycle of the original pass through a memoized state, so filling ends and loops close.
     */
    const fill = ({ from: first, to, env: start }: (typeof work)[number]): void => {
      const env: Env = new Map(start);
      const copied = new Set<string>();
      const goto = (target: string): BlockRec | string => {
        if (!loopHeads.has(target) && !copied.has(target) && !variants.has(keyOf(target, env)[0]))
          return st.get(target) as BlockRec;
        return variant(target, env);
      };
      for (let from: BlockRec | undefined = first; from; ) {
        copied.add(from.id);
        let next: BlockRec | undefined;
        for (const sid of from.stmts) {
          const s = st.get(sid) as StmtRec;
          switch (s.op) {
            case 'set': {
              const known = division.static.has(s.local!) ? ev(s.value!, env, false) : undefined;
              emit(to, { op: 'set', local: s.local, value: copy(s.value!, env) }, sid);
              if (known === undefined) env.delete(s.local!);
              else env.set(s.local!, known);
              break;
            }
            case 'br':
            case 'br_if': {
              const known = s.op === 'br' ? 1 : ev(s.cond!, env, true);
              if (known !== undefined) {
                const t = goto(s.op === 'br' ? s.to! : known ? s.then! : s.else!);
                if (typeof t === 'string') emit(to, { op: 'br', to: t }, sid);
                else next = t;
              } else
                emit(
                  to,
                  {
                    op: 'br_if',
                    cond: copy(s.cond!, env),
                    then: variant(s.then!, env),
                    else: variant(s.else!, env),
                  },
                  sid,
                );
              break;
            }
            default: {
              const { id: _id, kind: _kind, fn: _fn, origin: _origin, ...fields } = s;
              for (const k of ['value', 'cond', 'addr'] as const)
                if (fields[k]) fields[k] = copy(fields[k]!, env);
              emit(to, fields, sid);
            }
          }
        }
        from = next;
      }
    };

    // ---- the new entry: the guard (if asked), then one variant of the old entry per candidate
    const oldEntry = f.blocks[0];
    const entry = st.get(
      tx.block({ from: oldEntry.id, because: facts_, note: 'specialized entry' }),
    ) as BlockRec;
    f.blocks.splice(f.blocks.indexOf(entry), 1);
    f.blocks.unshift(entry);
    const initial = (extra: Env): Env => {
      const env: Env = new Map(extra);
      for (const l of f.locals) if (!l.param && division.static.has(l.index)) env.set(l.index, 0);
      return env;
    };
    const candidates = candidate?.binding.oneOf ?? [];
    const starts = candidate
      ? candidates.map(c => variant(oldEntry.id, initial(new Map([[candidate!.index, c]]))))
      : [variant(oldEntry.id, initial(new Map()))];
    while (work.length) fill(work.shift()!);

    // the chain of tests is built last: the guard compares what the variants read
    const tests: { cond: string; then?: string }[] = [];
    if (guard)
      for (const [p, b] of buffers) {
        if (!lengthRead.has(p)) continue;
        const cells = b.cells!;
        const because = [factRef(art, b)];
        tests.push({
          cond: tx.make('eq', tx.make('load', tx.get(p), { imm: 0 }), tx.const(cells.length, { because }), {
            because,
            note: `${f.locals[p].name}.length as bound`,
          }),
        });
        for (const i of [...(cellsRead.get(p) ?? [])].sort((a, b) => a - b))
          tests.push({
            cond: tx.make(
              'eq',
              tx.make('load16u', tx.make('caddr', tx.get(p), tx.const(i)), { imm: 4 }),
              tx.const(cells[i], { because }),
              { because, note: `${f.locals[p].name}[${i}] as bound` },
            ),
          });
      }
    // a promised candidate set: the last candidate needs no test; guarded: every candidate is tested
    const tested = candidate ? (guard ? candidates.length : candidates.length - 1) : 0;
    for (let k = 0; k < tested; k++)
      tests.push({
        cond: tx.make('eq', tx.get(candidate!.index), tx.const(candidates[k]), {
          because: [factRef(art, candidate!.binding)],
        }),
        then: starts[k],
      });
    const last = candidate ? (guard ? oldEntry.id : starts[starts.length - 1]) : starts[0];
    // each test: a guard test fails to the old entry and passes to the next test; a candidate test passes to its
    // variant and fails to the next test
    let block = entry;
    tests.forEach((t, k) => {
      const more = k + 1 < tests.length;
      const next = more
        ? (st.get(tx.block({ from: oldEntry.id, because: facts_, note: 'specialized entry' })) as BlockRec)
        : undefined;
      const onward = next ? next.id : last;
      emit(
        block,
        t.then
          ? { op: 'br_if', cond: t.cond, then: t.then, else: onward }
          : { op: 'br_if', cond: t.cond, then: onward, else: oldEntry.id },
        oldEntry.stmts.at(-1)!,
      );
      if (next) block = next;
    });
    if (!tests.length) emit(entry, { op: 'br', to: last }, oldEntry.stmts.at(-1)!);

    const names = (ls: Iterable<number>) => [...ls].map(l => f.locals[l].name);
    tx.record('specialized', {
      static: names([...division.static].sort((a, b) => a - b)),
      staticLoads: division.staticLoads.length,
      dynamicLoads: division.dynamicLoads.length,
      variants: variants.size,
      budget,
      overBudget,
      guard,
      cellsRead: Object.fromEntries(
        [...cellsRead].map(([p, s]) => [f.locals[p].name, [...s].sort((a, b) => a - b)]),
      ),
    });
  },
});

/**
 * The whole sequence for an interpreter (IRWB-036-G): specialize on the buffer, merge the straight-line variants
 * (`cfg`), promote the frame to locals while its addresses are still written out (`frame-slots`), propagate the
 * copies that leaves (`copyprop`, `dce`), then the `speed` pipeline. Each step is a checked revision of `p`; a
 * step the contract rejects is reported and skipped, as in `Program.pipeline`.
 */
export async function specializeInterpreter(
  p: import('./program.js').Program,
  bindings: Artifact<Bindings>,
  opts: { budget?: number; guard?: boolean } = {},
): Promise<Record<string, unknown>[]> {
  const { frameSlots } = await import('./frame-slots.js');
  const { copyprop } = await import('./copyprop.js');
  const steps: Record<string, unknown>[] = [{ ...(await p.specializeBuffer(bindings, opts)) }];
  const run = async (x: Parameters<typeof p.pipeline>[0]) =>
    steps.push(...((await p.pipeline(x)).steps as Record<string, unknown>[]));
  await run(['cfg']);
  for (const pass of [frameSlots, copyprop]) steps.push({ ...(await p.apply(pass)) });
  await run(['dce']);
  await run('speed');
  return steps;
}
