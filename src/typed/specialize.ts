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
import { TxError } from './tx.js';
import { typedPass } from './passes.js';
import type { StmtRec, Store, ValueRec, WorkFn } from './model.js';

/**
 * A parameter binding (`fn`, `param`): that parameter's value. A field binding (`record`, `field`): that field of
 * every record of the type a function receives as a parameter (Candela: `K.scene`), in every function. A buffer
 * binding (`fn`, `param`, `cells`, IRWB-036-F): the buffer parameter holds exactly these u16 cells for the whole
 * call (a promise about memory, checked by `bufferPromiseHolds`).
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
  /** Its value (an enum case's value for enum parameters); absent for a buffer binding. */
  readonly value?: number;
  /** A buffer binding: the buffer's cells. */
  readonly cells?: readonly number[];
  /** The entity of the outer artifact that establishes the fact (e.g. `candela:scene/cornell#K.scene`). */
  readonly entity: string;
  readonly note?: string;
}
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
    'parameter values a program will always be called with, and the outer entities that establish them',
  validate(value) {
    const v = value as Bindings;
    if (!v || v.formatVersion !== 1 || typeof v.source !== 'string' || !Array.isArray(v.bindings))
      throw new Error('typed.bindings: formatVersion 1, source and bindings required');
    for (const b of v.bindings) {
      const param = typeof b.fn === 'string' && typeof b.param === 'string';
      const field = typeof b.record === 'string' && typeof b.field === 'string';
      const cells =
        Array.isArray(b.cells) && b.cells.every((c: unknown) => typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 65535);
      if (
        param === field ||
        (b.cells !== undefined && (!param || !cells || b.value !== undefined)) ||
        (b.cells === undefined && !Number.isInteger(b.value)) ||
        typeof b.entity !== 'string'
      )
        throw new Error(`typed.bindings: malformed binding ${JSON.stringify(b)}`);
    }
  },
});

/** The reason a specialization cites: the outer artifact, its exact revision, and the entity. */
export const factRef = (art: Artifact<Bindings>, b: Binding) =>
  `fact:${art.kind}:${art.id}@${art.revision.slice(0, 12)}#${b.entity}`;

/**
 * True when an address is rooted at the frame array area: `aaddr`, an `add` with exactly one rooted operand, or a
 * read of a local every assignment of which is rooted. The front end checks every array index against the
 * array's length before the access (`if (i >=u n) trap`), so a rooted address stays inside the area.
 */
export function frameRooted(st: Store, f: WorkFn, id: string, seen = new Set<number>()): boolean {
  const v = st.get(id) as ValueRec;
  if (v.op === 'aaddr') return true;
  if (v.op === 'add') return v.args.filter(a => frameRooted(st, f, a, seen)).length === 1;
  if (v.op !== 'get' || f.locals[v.imm as number].param) return false;
  const l = v.imm as number;
  // a cycle through assignments (p = p + 4) is refused: its first value would need its own argument
  if (seen.has(l)) return false;
  seen = new Set(seen).add(l);
  let sets = 0;
  for (const blk of f.blocks)
    for (const sid of blk.stmts) {
      const s = st.get(sid) as StmtRec;
      if (s.op !== 'set' || s.local !== l) continue;
      sets++;
      if (!frameRooted(st, f, s.value!, seen)) return false;
    }
  return sets > 0;
}

/**
 * The static check of a buffer promise: refuse when `f` assigns the parameter, or when any function of the program
 * stores to an address that is not rooted at its own frame arrays (such a store could write the buffer). Returns
 * the reason it cannot hold, or null.
 */
export function bufferPromiseBroken(st: Store, f: WorkFn, param: number): string | null {
  for (const blk of f.blocks)
    for (const sid of blk.stmts) {
      const s = st.get(sid) as StmtRec;
      if (s.op === 'set' && s.local === param)
        return `${f.name} assigns ${f.locals[param].name} (${sid}); the buffer binding cannot hold`;
    }
  for (const g of st.fns.values())
    for (const blk of g.blocks)
      for (const sid of blk.stmts) {
        const s = st.get(sid) as StmtRec;
        if (s.op === 'store' && !frameRooted(st, g, s.addr!))
          return `${g.name} stores outside its frame arrays (${sid}); it could write ${f.locals[param].name}`;
      }
  return null;
}

/**
 * A cell load from a bound buffer: `load16u(caddr(get b, p), 4)` reads cell p, `load(get b, 0)` the length.
 * Returns the buffer parameter's index and the position value (null for the length), or undefined.
 */
export function bufferLoad(
  st: Store,
  v: ValueRec,
  bound: ReadonlyMap<number, readonly number[]>,
): { param: number; position: string | null } | undefined {
  if (v.op === 'load16u' && v.imm === 4) {
    const a = st.get(v.args[0]) as ValueRec;
    if (a.op !== 'caddr') return;
    const r = st.get(a.args[0]) as ValueRec;
    if (r.op === 'get' && bound.has(r.imm as number)) return { param: r.imm as number, position: a.args[1] };
  }
  if (v.op === 'load' && v.imm === 0 && !v.type) {
    const r = st.get(v.args[0]) as ValueRec;
    if (r.op === 'get' && bound.has(r.imm as number)) return { param: r.imm as number, position: null };
  }
  return;
}

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
      if (b.cells) {
        if (f.params[i] !== 'buffer' && f.params[i] !== 'string')
          throw new TxError('unsupported', `${f.name}'s ${b.param} is a ${f.params[i]}; bind a buffer`);
        const broken = bufferPromiseBroken(st, f, i);
        if (broken) throw new TxError('unsupported', broken);
        const cells = b.cells,
          bound = new Map([[i, cells]]);
        // a load at a constant position (or of the length) becomes the cell; a position past the end still traps
        tx.rewrite(v => {
          if (!v.statement) return;
          const at = bufferLoad(st, st.get(v.id) as ValueRec, bound);
          if (!at || !own(v, i)) return;
          const p = at.position === null ? null : (st.get(at.position) as ValueRec);
          if (p && (p.op !== 'const' || p.type || (p.imm as number) >>> 0 >= cells.length)) return;
          const k = p ? (p.imm as number) : -1;
          return tx.const(p ? cells[k] : cells.length, {
            because: [factRef(art, b)],
            note: p ? `${b.param}[${k}] = ${cells[k]} (${art.value.source})` : `${b.param}.length = ${cells.length}`,
          });
        });
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
