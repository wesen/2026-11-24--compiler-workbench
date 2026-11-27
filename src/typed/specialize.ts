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

/**
 * A parameter binding (`fn`, `param`): that parameter's value. A field binding (`record`, `field`): that field of
 * every record of the type a function receives as a parameter (Candela: `K.scene`), in every function.
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
  /** Its value (an enum case's value for enum parameters). Absent in the `cells` and `oneOf` forms. */
  readonly value?: number;
  /**
   * IRWB-036-G, parameter form only: the exact cells (u16) of a buffer parameter. The `specialize-buffer` pass
   * (specialize-buffer.ts) reads it; the `specialize` pass ignores it.
   */
  readonly cells?: readonly number[];
  /** IRWB-036-G, parameter form only: the values a scalar parameter can have (candidates to specialize on). */
  readonly oneOf?: readonly number[];
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
      const ints = (x: unknown) => Array.isArray(x) && x.every(n => Number.isInteger(n));
      const forms =
        +Number.isInteger(b.value) +
        +(ints(b.cells) && b.cells!.every((c: number) => c >= 0 && c <= 65535)) +
        +(ints(b.oneOf) && b.oneOf!.length > 0);
      const present = +(b.value !== undefined) + +(b.cells !== undefined) + +(b.oneOf !== undefined);
      if (param === field || forms !== 1 || present !== 1 || typeof b.entity !== 'string')
        throw new Error(`typed.bindings: malformed binding ${JSON.stringify(b)}`);
      if (field && b.value === undefined)
        throw new Error(`typed.bindings: a field binding needs a value ${JSON.stringify(b)}`);
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
      if (b.value === undefined) continue; // cells and oneOf: specialize-buffer's
      const value = b.value;
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
          return tx.const(value, {
            because: [factRef(art, b)],
            note: `${f.locals[base.imm as number].name}.${b.field} = ${value} (${art.value.source})`,
          });
        });
        continue;
      }
      if (b.fn !== f.name) continue;
      const i = f.locals.findIndex(l => l.param && l.name === b.param);
      if (i < 0) throw new TxError('unknownLocal', `${f.name} has no parameter "${b.param}"`);
      for (const blk of f.blocks)
        tx.rewrite(
          v => {
            if (v.op !== 'get' || v.imm !== i || !v.statement || !own(v, i)) return;
            return tx.const(value, {
              because: [factRef(art, b)],
              note: `${b.param} = ${value} (${art.value.source})`,
            });
          },
          [blk],
        );
    }
  },
});
