/**
 * IRWB-036-D: dispatch-loop specialization, the mechanical half of a first Futamura projection.
 *
 * An interpreter's dispatch loop reads the interpreted program through a checked address — `caddr(code, pc)` then a
 * load — and branches on what it read. When the interpreted program is a promise (a `cells` binding, see
 * `specialize.ts`) and the loop's own state is constant on an incoming edge, everything the dispatch does on that
 * edge is decidable at compile time. This pass makes that state constant *inside* the code: for every edge into a
 * dispatch head whose loop-carried locals all have known constants, it peels the loop into a copy whose head starts
 * by assigning those constants, and points the edge at the copy.
 *
 * The semantic work is not this pass's: the copied values are substituted with the state it knows, and then the
 * ordinary `fold` and `cfg` bodies (passed in by `passes.ts`) resolve the opcode comparisons, the bounds checks and
 * the stack arithmetic inside the copy — exactly as they do for every other pass — until a new state appears at the
 * loop head, which is peeled in turn. The result stays checked: the residual is an ordinary `typed.blocks` program
 * built from cloned, origin-carrying entities, and the whole fixpoint is one revision under the meaning contract.
 *
 * The state of an edge is the value of `assigned(loop) ∩ liveIn(head)` — the locals that survive the loop. The
 * program counter alone would leave the stack pointer dynamic (an index and a bounds check on every stack access);
 * the whole live-in set would include temporaries that are not loop-carried and never constant.
 *
 * When it stops: an edge whose state is not fully constant keeps the general dispatch (a mixed threading, which is
 * still correct and is what the report counts), an iteration that peels nothing ends the fixpoint, and `maxClones`
 * bounds the code one application may add.
 *
 * The spec is wrapped by `typedPass` in passes.ts (`dispatch`), which registers it; this module imports only types
 * from there, so the two do not form a cycle at load time.
 */
import type { Loop } from './analyses.js';
import type { BlockRec, StmtRec, Store, ValueRec, WorkFn } from './model.js';
import type { TypedPassSpec } from './passes.js';
import type { Tx } from './tx.js';

export interface DispatchOptions {
  /** Copies one application may add per function (default 64). */
  readonly maxClones?: number;
  /** Peel-and-clean iterations one application may run per loop (default 64). */
  readonly maxRounds?: number;
}

/** The cleanup bodies the peel runs on its own copies: `fold` and `cfg` (neither needs an analysis fact). */
export interface DispatchCleanup {
  readonly fold: { readonly typed: { body(ctx: any): void } };
  readonly cfg: { readonly typed: { body(ctx: any): void } };
}

const lastStmt = (st: Store, b: BlockRec): StmtRec | undefined =>
  b.stmts.length ? (st.get(b.stmts.at(-1)!) as StmtRec) : undefined;

/** Whether a block reads memory at an index that is a local: `load*[caddr(x, get l)…]` or its arithmetic. */
function indexesWithLocal(st: Store, b: BlockRec): Set<number> {
  const out = new Set<number>();
  const seen = new Set<string>();
  const walk = (vid: string): void => {
    if (seen.has(vid)) return;
    seen.add(vid);
    const v = st.get(vid) as ValueRec;
    if (v.op === 'caddr') {
      const p = st.get(v.args[1]) as ValueRec | undefined;
      if (p && p.op === 'get') out.add(p.imm as number);
    }
    for (const a of v.args) walk(a);
  };
  for (const sid of b.stmts) {
    const s = st.get(sid) as StmtRec;
    for (const v of [s.value, s.cond, s.addr]) if (v) walk(v);
  }
  return out;
}

/**
 * The constant value of each local of interest on every edge, by a forward analysis over the CFG: a block's
 * out-state gives a local a number when every path into the block and every assignment in it agrees on it, and
 * `undefined` otherwise. A value that is not a `const` yet counts as `undefined`, so an expression the folder has not
 * resolved simply postpones the peel to the next iteration.
 */
function edgeStates(st: Store, f: WorkFn, locals: readonly number[]): Map<string, (number | undefined)[]> {
  const known = new Map<string, (number | undefined)[]>();
  const unknown = () => locals.map(() => undefined as number | undefined);
  const transfer = (b: BlockRec, input: (number | undefined)[]) => {
    const out = input.slice();
    for (const sid of b.stmts) {
      const s = st.get(sid) as StmtRec;
      if (s.op !== 'set' || s.local === undefined) continue;
      const i = locals.indexOf(s.local);
      if (i < 0) continue;
      const v = st.get(s.value!) as ValueRec;
      out[i] = v.op === 'const' ? (v.imm as number) : undefined;
    }
    return out;
  };
  const work = [f.blocks[0].id];
  const seen = new Set(work);
  for (const b of f.blocks) known.set(b.id, unknown());
  while (work.length) {
    const bid = work.pop()!;
    seen.delete(bid);
    const b = st.get(bid) as BlockRec;
    const out = transfer(b, known.get(bid) ?? unknown());
    const before = known.get(bid)!;
    if (!out.every((x, i) => x === before[i])) known.set(bid, out);
    for (const s of b.succ) {
      const prev = known.get(s) ?? unknown();
      const next = prev.map((x, i) => (x === out[i] ? x : undefined));
      if (!next.every((x, i) => x === prev[i])) known.set(s, next);
      if (!seen.has(s)) {
        seen.add(s);
        work.push(s);
      }
    }
  }
  return known;
}

/** The blocks of the natural loop of `head` in the current CFG: what reaches the head, and what the head reaches. */
function loopBody(st: Store, f: WorkFn, head: string): string[] {
  const preds = new Map<string, string[]>(f.blocks.map(b => [b.id, []]));
  for (const b of f.blocks) for (const s of b.succ) preds.get(s)?.push(b.id);
  const ancestors = new Set<string>();
  const work = [...(preds.get(head) ?? [])];
  while (work.length) {
    const x = work.pop()!;
    if (x === head || ancestors.has(x)) continue;
    ancestors.add(x);
    work.push(...(preds.get(x) ?? []));
  }
  const forwards = new Set<string>();
  const fw = [head];
  while (fw.length) {
    const x = fw.pop()!;
    if (forwards.has(x)) continue;
    forwards.add(x);
    const b = st.get(x) as BlockRec | undefined;
    if (b) fw.push(...b.succ);
  }
  return [...ancestors].filter(x => forwards.has(x));
}

export const makeDispatch = (cleanup: DispatchCleanup): TypedPassSpec => ({
  name: 'dispatch',
  about:
    'dispatch-loop specialization: a loop head whose state is constant on an edge gets a copy specialized to that state',
  needs: { loops: 'loops', live: 'liveness' },
  writes: ['cfg', 'stmts', 'values'],
  body({ st, f, tx, facts, params }) {
    const opts = (params ?? {}) as DispatchOptions;
    const maxClones = opts.maxClones ?? 64;
    const maxRounds = opts.maxRounds ?? 64;
    const live = facts.live!;
    for (const L of facts.loops ?? []) {
      const head = st.get(L.head) as BlockRec;
      // a dispatch head reads memory at an index it holds in a local
      const indexed = new Set<number>();
      for (const bid of L.body) for (const l of indexesWithLocal(st, st.get(bid) as BlockRec)) indexed.add(l);
      if (!indexed.size) continue;
      const liveIn = live.liveIn(L.head);
      const state = L.assigned.filter(l => liveIn.has(l));
      if (!state.length) continue;
      // a state is materialized once: its key names the copy, by a statement that survives block merging
      const memo = new Map<string, string>();
      let clones = 0;
      for (let round = 0; round < maxRounds; round++) {
        if (!f.blocks.some(b => b.id === L.head)) break; // every edge was threaded: the general head is gone
        const peeled = peelRound(st, f, tx, L.head, L.body, state, memo, () => {
          if (clones >= maxClones) return false;
          clones++;
          return true;
        });
        if (!peeled) break;
        // the copy is constants and folded trees now: resolve its opcode comparisons and bounds checks
        cleanup.fold.typed.body({ st, f, tx, facts, params });
        cleanup.cfg.typed.body({ st, f, tx, facts, params });
      }
      tx.note(
        `dispatch: ${L.id} reads memory at locals ${[...indexed].map(i => f.locals[i].name).join(', ')};` +
          ` ${clones} copy/copies of ${state.map(i => f.locals[i].name).join(', ')}`,
      );
    }
  },
});

/**
 * One round: every edge into the head whose state is fully known goes to a copy specialized to that state (or to
 * the copy an earlier edge already made), and a copy is made for a state nobody has seen yet. The edit that binds a
 * state is what the memo keeps, not the block: `cfg` merges the copy's head into its only predecessor, and the
 * statement is still there to name where the state's code begins.
 */
function peelRound(
  st: Store,
  f: WorkFn,
  tx: Tx,
  headId: string,
  template: readonly string[],
  state: readonly number[],
  memo: Map<string, string>,
  budget: () => boolean,
): boolean {
  const out = edgeStates(st, f, state);
  let peeled = false;
  for (const u of f.blocks.slice()) {
    const last = lastStmt(st, u);
    if (!last) continue;
    for (const k of ['to', 'then', 'else'] as const) {
      if (last[k] !== headId) continue;
      const s = out.get(u.id);
      if (!s || s.some(x => x === undefined)) continue;
      const key = s.join(',');
      const known = memo.get(key);
      let entry = known ? (tx.blockOf(known)?.id ?? undefined) : undefined;
      if (!entry) {
        if (!budget()) continue;
        const made = peel(st, f, tx, headId, template, state, s as number[], key);
        memo.set(key, made.bind);
        entry = made.block;
        peeled = true;
      } else if (peeled === false) peeled = true;
      if (entry !== last[k])
        tx.setField(last.id, k, entry, {
          because: [headId],
          note: `dispatch state ${state.map((l, i) => `${f.locals[l].name}=${s[i]}`).join(' ')}`,
        });
    }
  }
  return peeled;
}

/**
 * One copy of the loop, with the state assigned at its head. Every block of the loop is copied and every edge
 * between copies is redirected inside the copy, so the copy is private and each of its blocks has only predecessors
 * from the copy: the constant propagation that follows cannot meet the general loop's unknown state again. The one
 * exception is an edge into the head, which returns to the loop as it is, so the next round peels the state it
 * carries.
 */
function peel(
  st: Store,
  f: WorkFn,
  tx: Tx,
  headId: string,
  template: readonly string[],
  state: readonly number[],
  values: readonly number[],
  key: string,
): { block: string; bind: string } {
  // the loop as the analysis saw it; a copy per state is entered once and pruned with the rest if it is not used
  const body = template.filter(bid => st.has(bid));
  const copies = new Map<string, string>();
  for (const bid of body) copies.set(bid, tx.block({ because: [headId], note: `dispatch state ${key}` }));
  const constant = new Map(state.map((l, i) => [l, values[i]]));
  for (const bid of body) {
    const src = st.get(bid) as BlockRec,
      dst = st.get(copies.get(bid)!) as BlockRec;
    const copyValue = (vid: string | undefined): string | undefined => {
      if (!vid) return undefined;
      const v = st.get(vid) as ValueRec;
      // the state, substituted where the copy reads it: `t6 = pc` becomes `t6 = 0` without another pass
      if (v.op === 'get' && constant.has(v.imm as number))
        return tx.const(constant.get(v.imm as number)!, {
          because: [headId],
          note: `${f.locals[v.imm as number].name} = ${constant.get(v.imm as number)} (dispatch state ${key})`,
        });
      const args = v.args.map(a => copyValue(a)!);
      return tx.make(v.op, ...args, {
        from: vid,
        because: [headId],
        ...(v.imm !== undefined ? { imm: v.imm } : {}),
        ...(v.type ? { type: v.type } : {}),
      });
    };
    const inside = (target: string | undefined) =>
      target && target !== headId && copies.has(target) ? copies.get(target)! : target;
    for (const sid of src.stmts) {
      const s = st.get(sid) as StmtRec;
      dst.stmts.push(
        tx.stmt(
          {
            op: s.op,
            ...(s.local !== undefined ? { local: s.local } : {}),
            ...(s.value ? { value: copyValue(s.value)! } : {}),
            ...(s.cond ? { cond: copyValue(s.cond)! } : {}),
            ...(s.addr ? { addr: copyValue(s.addr)! } : {}),
            ...(s.offset !== undefined ? { offset: s.offset } : {}),
            ...(s.width !== undefined ? { width: s.width } : {}),
            ...(s.bytes !== undefined ? { bytes: s.bytes } : {}),
            ...(s.why !== undefined ? { why: s.why } : {}),
            ...(s.to ? { to: inside(s.to)! } : {}),
            ...(s.then ? { then: inside(s.then)! } : {}),
            ...(s.else ? { else: inside(s.else)! } : {}),
          },
          { from: sid, because: [headId] },
        ),
      );
    }
    dst.succ = src.succ.map(s => inside(s)!).filter(Boolean);
  }
  const head = copies.get(headId)!;
  // the state, assigned where the copy starts: from here on it is what the substituted reads see
  let bind = '';
  for (let i = state.length - 1; i >= 0; i--) {
    const c = tx.const(values[i]!, { because: [headId], note: `${f.locals[state[i]].name} = ${values[i]}` });
    const set = tx.set(state[i], c, { because: [headId] });
    tx.insert(tx.at.start(head), set, { because: [headId] });
    if (!bind) bind = set;
  }
  return { block: head, bind };
}
