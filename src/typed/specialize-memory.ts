/** Binding-time analysis and residual CFG construction over Typed blocks. */
import type { LiveView } from './analyses.js';
import { binop, I32_BINARY } from './evaluate.js';
import type { BlockRec, StmtRec, Store, ValueRec, WorkFn } from './model.js';
import type { Binding } from './specialize.js';
import { TxError, type Tx } from './tx.js';

type Static =
  | number
  | { kind: 'buffer'; param: number }
  | { kind: 'cell'; param: number; index: number }
  | { kind: 'frame'; offset: number };
type State = Map<number, Static>;
interface Value {
  id: string;
  known?: Static;
}

export function residualize(
  st: Store,
  f: WorkFn,
  tx: Tx,
  live: LiveView,
  bindings: readonly Binding[],
  because: readonly string[],
  budget: unknown,
): void {
  const entry = f.blocks[0];
  const originalBlocks = f.blocks.length;
  const initial: State = new Map();
  const buffers = new Map<number, readonly number[]>();
  const unsupported = (message: string): never => {
    throw new TxError('unsupported', `${f.name}: ${message}`);
  };
  for (const b of bindings) {
    const i = f.locals.findIndex(l => l.param && l.name === b.param);
    if (i < 0) unsupported(`no parameter "${b.param}"`);
    if (b.cells !== undefined) {
      initial.set(i, { kind: 'buffer', param: i });
      buffers.set(i, b.cells);
    } else {
      if (f.params[i] !== 'i32' || (b.value | 0) !== b.value)
        unsupported(`${b.param} must be a signed i32 parameter binding`);
      initial.set(i, b.value);
    }
  }

  // Enough for one variant per source block per cell. Other static dimensions can exceed it.
  const cells = [...buffers.values()].reduce((sum, b) => sum + b.length, 0);
  const maxVariants = budget ?? originalBlocks * Math.max(1, cells);
  if (typeof maxVariants !== 'number' || !Number.isSafeInteger(maxVariants) || maxVariants <= 0)
    throw new TxError('unsupported', `${f.name}: maxVariants must be a positive integer`);

  const limit = maxVariants;
  const queue: { source: BlockRec; target: BlockRec; state: State }[] = [];
  const variants = new Map<string, string>();
  function variant(sourceId: string, incoming: State): string {
    // Dead locals would distinguish otherwise equivalent trips around the dispatch.
    const state = new Map(
      [...live.liveIn(sourceId)]
        .sort((a, b) => a - b)
        .flatMap(i => {
          const known = incoming.get(i);
          return known === undefined ? [] : [[i, known] as const];
        }),
    );
    const key = JSON.stringify([sourceId, [...state]]);
    const found = variants.get(key);
    if (found) return found;
    if (variants.size >= limit)
      unsupported(`residual block budget (${limit}) exhausted at ${sourceId}`);
    const source = st.get(sourceId) as BlockRec;
    const target = st.get(tx.block({ from: sourceId, because })) as BlockRec;
    variants.set(key, target.id);
    queue.push({ source, target, state });
    return target.id;
  }

  function frameOffset(known: Static | undefined, offset: number, width: number): number | undefined {
    if (typeof known !== 'object' || known.kind !== 'frame') return;
    const start = known.offset + offset;
    if (start >= 0 && start + width <= (f.arrayBytes ?? 0)) return start;
  }

  function value(id: string, state: State): Value {
    const v = st.get(id) as ValueRec;
    const from = { from: id, because };
    const emit = (args: readonly Value[], known?: Static): Value => ({
      id: tx.make(v.op, ...args.map(a => a.id), { ...from, imm: v.imm, type: v.type }),
      known,
    });
    const constant = (known: number): Value => ({ id: tx.const(known, from), known });
    if (v.op === 'const') return emit([], v.type ? undefined : (v.imm as number));
    if (v.op === 'get') {
      const known = state.get(v.imm as number);
      return typeof known === 'number' ? constant(known) : emit([], known);
    }
    if (v.op === 'aaddr') return emit([], { kind: 'frame', offset: v.imm as number });
    if (v.op === 'call') unsupported(`reachable call at ${id}`);
    const args = v.args.map(a => value(a, state));
    const a = args[0]?.known;
    const b = args[1]?.known;
    if (v.op === 'caddr') {
      if (typeof a !== 'object' || a.kind !== 'buffer' || typeof b !== 'number')
        return unsupported(`checked address has no static buffer and index at ${id}`);
      const index = b >>> 0;
      if (index >= buffers.get(a.param)!.length)
        return unsupported(`checked address out of range at ${id} (index ${index})`);
      return emit(args, { kind: 'cell', param: a.param, index });
    }
    if (v.op === 'load16u' || v.op === 'load') {
      if (v.op === 'load16u' && v.imm === 4 && typeof a === 'object' && a.kind === 'cell')
        return constant(buffers.get(a.param)![a.index]);
      if (v.op === 'load' && !v.type && v.imm === 0 && typeof a === 'object' && a.kind === 'buffer')
        return constant(buffers.get(a.param)!.length);
      const at = frameOffset(a, v.imm as number, v.op === 'load' ? 4 : 2);
      if (at === undefined) return unsupported(`load has no known private frame slot at ${id}`);
      const base = tx.make('aaddr', { ...from, imm: at });
      return { id: tx.make(v.op, base, { ...from, imm: 0, type: v.type }) };
    }
    if (v.op === 'add' && typeof a === 'object' && a.kind === 'frame' && typeof b === 'number')
      return emit(args, { kind: 'frame', offset: (a.offset + b) | 0 });
    if (v.op === 'eqz' && typeof a === 'number') return constant(+(a === 0));
    if (
      typeof a === 'number' &&
      typeof b === 'number' &&
      I32_BINARY.has(v.op) &&
      v.op !== 'div' &&
      v.op !== 'rem'
    )
      return constant(binop(v.op, a, b));
    return emit(args);
  }

  variant(entry.id, initial);
  for (const { source, target, state } of queue) {
    const append = (s: Partial<StmtRec> & { op: StmtRec['op'] }, from: string) => {
      target.stmts.push(tx.stmt(s, { from, because }));
    };
    for (const sid of source.stmts) {
      const s = st.get(sid) as StmtRec;
      const { op, local, width, offset, bytes, why } = s;
      switch (op) {
        case 'set': {
          const v = value(s.value!, state);
          if (v.known === undefined) state.delete(local!);
          else state.set(local!, v.known);
          append({ op, local, value: v.id }, sid);
          break;
        }
        case 'store': {
          const a = value(s.addr!, state);
          const at = frameOffset(a.known, offset!, width! / 8);
          if (at === undefined) unsupported(`store may alias the promised buffer at ${sid}`);
          const addr = tx.make('aaddr', { from: s.addr, imm: at, because });
          append({ op, width, offset: 0, addr, value: value(s.value!, state).id }, sid);
          break;
        }
        case 'br_if': {
          const cond = value(s.cond!, state);
          if (typeof cond.known === 'number')
            append({ op: 'br', to: variant(cond.known ? s.then! : s.else!, state) }, sid);
          else
            append({ op, cond: cond.id, then: variant(s.then!, state), else: variant(s.else!, state) }, sid);
          break;
        }
        case 'br':
          append({ op, to: variant(s.to!, state) }, sid);
          break;
        case 'return':
        case 'eval':
          append({ op, value: value(s.value!, state).id }, sid);
          break;
        case 'zero':
          append({ op, offset, bytes }, sid);
          break;
        case 'trap':
          append({ op, ...(why ? { why } : {}) }, sid);
          break;
      }
    }
    const last = st.get(target.stmts.at(-1)!) as StmtRec | undefined;
    if (!last || !['br', 'br_if', 'return', 'trap'].includes(last.op))
      append({ op: 'br', to: variant(source.succ[0], state) }, source.id);
  }

  // The transaction prunes the old CFG and records its removals from the new entry.
  f.blocks.unshift(f.blocks.splice(originalBlocks, 1)[0]);
}
