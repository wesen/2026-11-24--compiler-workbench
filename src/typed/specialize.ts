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
import type { Artifact } from '../framework/core/types.js';
import { TxError } from './tx.js';
import { BindingsIR, checkBufferBinding, factRef, isBufferBinding } from './bindings.js';
import type { Binding, Bindings } from './bindings.js';
import { typedPass } from './passes.js';

export { BindingsIR, factRef, isBufferBinding, checkBufferBinding } from './bindings.js';
export type { Binding, Bindings } from './bindings.js';

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
      if (isBufferBinding(b)) {
        // the promise is checked the way a field binding's is; the loads are folded by the peval pass
        if (b.fn === f.name) checkBufferBinding(st, f.name, f.locals, b.param!);
        continue;
      }
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
