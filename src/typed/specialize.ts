/**
 * Specialization on facts from an outer artifact (design-doc 03).
 *
 * A front end above Typed (Candela, for the gallery) knows facts that Typed code cannot see: the scene index a
 * kernel instance will always be called with, the layout of a scene's packed rows. Such facts travel as a
 * `typed.bindings` artifact: for a function and one of its parameters, the value it will have, and the entity of
 * the outer artifact that says so.
 *
 * The `specialize` pass replaces each read of a bound parameter whose only reaching definition is the parameter
 * itself by the constant, and records `because: fact:<artifact>@<revision>#<entity>`. The ordinary passes then do
 * the rest (fold the comparisons, cfg the constant branches, dce the dead code), and `why` on anything they removed
 * reaches the outer fact through the because-chain.
 *
 * Specialization changes what the program means for inputs that violate the bindings, so the contract changes
 * with it: the program is checked against r0 only on cases that satisfy the bindings (`Program.assume`), and every
 * later pass is held to the same restricted contract.
 */
import { defineIR } from '../framework/contracts/definitions.js';
import type { Artifact } from '../framework/core/types.js';
import { readsOf, stmtValues } from './analyses.js';
import type { StmtRec, Store, ValueRec, WorkFn } from './model.js';
import { statementOf, TxError, type Tx } from './tx.js';
import { typedPass } from './passes.js';

/**
 * A parameter binding (`fn`, `param`): that parameter's value. A field binding (`record`, `field`): that field of
 * every record of the type a function receives as a parameter (Candela: `K.scene`), in every function. A buffer
 * binding (`fn`, `param`, `cells`, IRWB-036-D): that parameter's whole buffer, capacity and contents.
 */
export interface Binding {
  /** The function whose parameter is bound. */
  readonly fn?: string;
  /** The parameter's name. */
  readonly param?: string;
  /** The record type whose field is bound (field form). */
  readonly record?: string;
  /** The field's name (field form). */
  readonly field?: string;
  /** Its value (an enum case's value for enum parameters); absent in the buffer form. */
  readonly value?: number;
  /**
   * The buffer's contents in UTF-16 cells, capacity first (buffer form): the host's promise that every call this
   * program's checks consider passes exactly this buffer as that parameter, and that the program never writes it.
   */
  readonly cells?: readonly number[];
  /** The entity of the outer artifact that establishes the fact (e.g. `candela:scene/cornell#K.scene`). */
  readonly entity: string;
  readonly note?: string;
}

/** The forms a binding takes; a buffer binding is the one that promises memory. */
export const isBufferBinding = (b: Binding): boolean => Array.isArray(b.cells);
export interface Bindings {
  readonly formatVersion: 1;
  /** What produced the facts (e.g. `candela`). */
  readonly source: string;
  readonly bindings: readonly Binding[];
}

export const BindingsIR = defineIR<Bindings>({
  id: 'typed.bindings',
  version: '1',
  description:
    'parameter values and buffer contents a program will always be called with, and the outer entities that establish them',
  validate(value) {
    const v = value as Bindings;
    if (!v || v.formatVersion !== 1 || typeof v.source !== 'string' || !Array.isArray(v.bindings))
      throw new Error('typed.bindings: formatVersion 1, source and bindings required');
    for (const b of v.bindings) {
      const param = typeof b.fn === 'string' && typeof b.param === 'string';
      const field = typeof b.record === 'string' && typeof b.field === 'string';
      const buffer = isBufferBinding(b);
      // one form per binding: a parameter's value (or, with cells, its whole buffer), or a record's field
      if (Number(param) + Number(field) !== 1 || typeof b.entity !== 'string')
        throw new Error(`typed.bindings: malformed binding ${JSON.stringify(b)}`);
      if (buffer) {
        if (!param) throw new Error(`typed.bindings: a buffer binding needs fn and param: ${JSON.stringify(b)}`);
        if (b.value !== undefined)
          throw new Error(`typed.bindings: a buffer binding has no value: ${JSON.stringify(b)}`);
        if (!b.cells!.every((c: number) => Number.isInteger(c) && c >= 0 && c <= 65535))
          throw new Error(`typed.bindings: buffer cells must be 0…65535: ${JSON.stringify(b.entity)}`);
      } else if (!param && !field)
        throw new Error(`typed.bindings: a binding needs fn and param, or record and field: ${JSON.stringify(b)}`);
      else if (!Number.isInteger(b.value))
        throw new Error(`typed.bindings: malformed binding ${JSON.stringify(b)}`);
    }
  },
});

/** The reason a specialization cites: the outer artifact, its exact revision, and the entity. */
export const factRef = (art: Artifact<Bindings>, b: Binding) =>
  `fact:${art.kind}:${art.id}@${art.revision.slice(0, 12)}#${b.entity}`;

export const specialize = typedPass({
  name: 'specialize',
  about: 'specialization: reads of a parameter bound by an outer fact become that constant',
  needs: { reach: 'reaching' },
  writes: ['values'],
  preserves: ['cfg', 'dominators', 'loops'],
  body({ st, f, tx, facts, params }) {
    const art = params.bindings as Artifact<Bindings> | undefined;
    if (!art || art.kind !== BindingsIR.id)
      throw new TxError('unsupported', 'specialize needs params.bindings: a typed.bindings artifact');
    // only the parameter's own value: a read whose single reaching definition is the parameter
    const own = (v: { statement?: string | null }, i: number) => {
      const defs = facts.reach!.reachingAt(v.statement!, i);
      return defs.length === 1 && defs[0] === `param:${i}`;
    };
    for (const b of art.value.bindings) {
      if (b.record && b.field) {
        const layout = (
          st.frontEnd.records as Record<string, Record<string, { type: string; offset: number }>> | null
        )?.[b.record];
        const fld = layout?.[b.field];
        if (!fld)
          throw new TxError('unsupported', `no field ${b.record}.${b.field} in the program's records`);
        if (fld.type === 'f32')
          throw new TxError('unsupported', `${b.record}.${b.field} is an f32; bind an integer field`);
        const params = f.params.map((t, i) => (t === b.record ? i : -1)).filter(i => i >= 0);
        if (!params.length) continue;
        // a store to the field would make the fact false inside the program: refuse rather than assume
        for (const blk of f.blocks)
          for (const sid of blk.stmts) {
            const s = st.get(sid) as { op: string; addr?: string; offset?: number };
            if (s.op !== 'store' || s.offset !== fld.offset) continue;
            const a = st.get(s.addr!) as { op: string; imm?: number };
            if (a.op === 'get' && params.includes(a.imm as number))
              throw new TxError(
                'unsupported',
                `${f.name} writes ${b.record}.${b.field} (${sid}); the binding cannot hold`,
              );
          }
        tx.rewrite(v => {
          if (v.op !== 'load' || v.imm !== fld.offset || !v.statement) return;
          const base = v.args[0];
          if (
            !base ||
            base.op !== 'get' ||
            !params.includes(base.imm as number) ||
            !own(v, base.imm as number)
          )
            return;
          return tx.const(b.value!, {
            because: [factRef(art, b)],
            note: `${f.locals[base.imm as number].name}.${b.field} = ${b.value} (${art.value.source})`,
          });
        });
        continue;
      }
      if (b.fn !== f.name) continue;
      const i = f.locals.findIndex(l => l.param && l.name === b.param);
      if (i < 0) throw new TxError('unknownLocal', `${f.name} has no parameter "${b.param}"`);
      if (isBufferBinding(b)) {
        foldPromisedBuffer(st, f, tx, art, b, i, own);
        continue;
      }
      for (const blk of f.blocks)
        tx.rewrite(
          v => {
            if (v.op !== 'get' || v.imm !== i || !v.statement || !own(v, i)) return;
            return tx.const(b.value!, {
              because: [factRef(art, b)],
              note: `${b.param} = ${b.value} (${art.value.source})`,
            });
          },
          [blk],
        );
    }
  },
});

/**
 * IRWB-036-D: the binding-time analysis over one promised buffer, and the rewrite that folds its loads.
 *
 * The promise says the buffer parameter holds `cells` for the whole call, so an abstract interpretation over value
 * trees can carry a *region-relative pointer* up from `get p` through `caddr` and arithmetic, and read the word a
 * load addresses. Three checks keep it sound:
 *   - the parameter is never reassigned in the function (a write to the local would change the buffer);
 *   - no `store`'s address reads the parameter, and no `call` receives it: the program cannot write the buffer, so
 *     the promise holds for the whole call (the same static check the field form makes with a store);
 *   - a `caddr` folds only when its position is below the capacity the promise gives (unsigned), so the trap it
 *     carries is proved away rather than assumed away.
 * A value whose abstract meaning is a pointer is never materialized: only a load becomes a constant, and the
 * address chain under it disappears with the load.
 */
function foldPromisedBuffer(
  st: Store,
  f: WorkFn,
  tx: Tx,
  art: Artifact<Bindings>,
  b: Binding,
  param: number,
  own: (v: { statement?: string | null }, i: number) => boolean,
): void {
  const cells = b.cells!;
  for (const blk of f.blocks)
    for (const sid of blk.stmts) {
      const s = st.get(sid) as StmtRec;
      if (s.op === 'set' && s.local === param)
        throw new TxError(
          'unsupported',
          `${f.name} assigns its buffer parameter ${b.param} (${sid}); the promise cannot hold`,
        );
      if (s.op === 'store' && readsOf(st, s.addr).has(param))
        throw new TxError(
          'unsupported',
          `${f.name} writes memory through ${b.param} (${sid}); the promise cannot hold`,
        );
      for (const vid of stmtValues(s))
        for (const call of callsOf(st, vid))
          if (readsOf(st, call).has(param))
            throw new TxError(
              'unsupported',
              `${f.name} passes ${b.param} to a call (${sid}); the promise cannot hold`,
            );
    }
  // the abstract interpretation: 'ptr' is a byte offset into the promised buffer, 'top' says nothing
  type Abs = { k: 'const'; n: number } | { k: 'ptr'; off: number } | { k: 'top' };
  const TOP: Abs = { k: 'top' };
  const sigma = new Map<string, Abs>();
  const abs = (vid: string): Abs => {
    const memo = sigma.get(vid);
    if (memo) return memo;
    const v = st.get(vid) as ValueRec;
    const args = v.args.map(abs);
    const of = (a: Abs) => (a.k === 'const' ? a.n : undefined);
    let out: Abs = TOP;
    const arith = (n: number): Abs => (Number.isFinite(n) ? { k: 'ptr', off: n } : TOP);
    switch (v.op) {
      case 'const':
        out = { k: 'const', n: v.imm as number };
        break;
      case 'get':
        // the parameter's own value, as the field form reads a field through it
        // `own` asks the reaching-definition fact whether this read is the parameter itself
        out =
          v.imm === param && own({ statement: statementOf(st, vid) }, param) ? { k: 'ptr', off: 0 } : TOP;
        break;
      case 'add': {
        const [x, y] = args as [Abs, Abs];
        if (x.k === 'ptr' && of(y) !== undefined) out = arith(x.off + of(y)!);
        else if (y.k === 'ptr' && of(x) !== undefined) out = arith(y.off + of(x)!);
        else if (x.k === 'const' && y.k === 'const') out = { k: 'const', n: (x.n + y.n) | 0 };
        break;
      }
      case 'sub': {
        const [x, y] = args as [Abs, Abs];
        if (x.k === 'ptr' && of(y) !== undefined) out = arith(x.off - of(y)!);
        else if (x.k === 'const' && y.k === 'const') out = { k: 'const', n: (x.n - y.n) | 0 };
        break;
      }
      case 'caddr': {
        // text.checked_address: the position must be below the capacity, which the promise fixes
        const [r, p] = args as [Abs, Abs];
        const at = of(p);
        if (r.k === 'ptr' && at !== undefined && at >>> 0 < cells.length) out = arith(r.off + 2 * at);
        break;
      }
      case 'load16u': {
        const [a] = args as [Abs];
        const at = a.k === 'ptr' ? a.off + (v.imm as number) : NaN;
        // the buffer's byte 0 is its capacity (u32), its data starts at byte 4
        const i = (at - 4) / 2;
        if (at >= 4 && Number.isInteger(i) && i < cells.length) out = { k: 'const', n: cells[i] };
        break;
      }
      case 'load': {
        const [a] = args as [Abs];
        if (v.type === 'f32') break; // an f32 word is a promise's bits; only i32 loads are folded here
        const at = a.k === 'ptr' ? a.off + (v.imm as number) : NaN;
        const i = (at - 4) / 2;
        if (at >= 4 && Number.isInteger(i) && i + 1 < cells.length)
          out = { k: 'const', n: (cells[i] | (cells[i + 1] << 16)) | 0 };
        break;
      }
    }
    sigma.set(vid, out);
    return out;
  };
  for (const blk of f.blocks)
    tx.rewrite(
      v => {
        const isLoad = v.op === 'load16u' || v.op === 'load';
        if (!isLoad || v.imm === undefined) return;
        const a = v.args[0];
        if (!a) return;
        const at = abs(a.id);
        if (at.k !== 'ptr') return;
        const addr = at.off + (v.imm as number),
          i = (addr - 4) / 2;
        // the buffer's byte 0 is its capacity (u32); its data starts at byte 4, one u16 cell every two bytes
        if (!(addr >= 4 && Number.isInteger(i))) return;
        const n =
          v.op === 'load16u'
            ? i < cells.length
              ? cells[i]
              : undefined
            : (st.get(v.id) as ValueRec).type === 'f32' || i + 1 >= cells.length
              ? undefined
              : (cells[i] | (cells[i + 1] << 16)) | 0;
        if (n === undefined) return;
        return tx.const(n, {
          because: [factRef(art, b)],
          note: `${b.param} word ${i} = ${n} (${art.value.source})`,
        });
      },
      [blk],
    );
}

/** The `call` values anywhere inside a value tree. */
function callsOf(st: Store, vid: string | undefined, acc: string[] = []): string[] {
  if (!vid) return acc;
  const v = st.get(vid) as ValueRec;
  if (v.op === 'call') acc.push(vid);
  for (const a of v.args) callsOf(st, a, acc);
  return acc;
}
