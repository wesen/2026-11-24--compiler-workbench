/**
 * Block-local copy propagation (IRWB-036-G): after `a = b`, a read of `a` in the same block reads `b` instead,
 * until either local is assigned again. Locals are private to a function's frame, so nothing but a `set` changes
 * one. The copies themselves stay; `dce` removes those that are no longer read.
 *
 * The existing `subst` forwards a definition into its single reader; a promoted interpreter stack (frame-slots)
 * is the opposite shape: one local (`slot0`) assigned many times, each time a copy read once or twice.
 */
import type { StmtRec, ValueRec } from './model.js';
import { typedPass } from './passes.js';

export const copyprop = typedPass({
  name: 'copyprop',
  about: 'copy propagation within a block: after a = b, reads of a read b until either is assigned',
  writes: ['values'],
  preserves: ['cfg', 'dominators', 'loops'],
  body({ st, f, tx }) {
    for (const b of f.blocks) {
      // for each statement, the copies that hold before it: local -> the local it equals and the copy statement
      const before = new Map<string, Map<number, { src: number; stmt: string }>>();
      const copies = new Map<number, { src: number; stmt: string }>();
      for (const sid of b.stmts) {
        before.set(sid, new Map(copies));
        const s = st.get(sid) as StmtRec;
        if (s.op !== 'set') continue;
        const v = st.get(s.value!) as ValueRec;
        const source =
          v.op === 'get' ? (copies.get(v.imm as number) ?? { src: v.imm as number, stmt: sid }) : undefined;
        copies.delete(s.local!);
        for (const [l, c] of copies) if (c.src === s.local) copies.delete(l);
        if (source && source.src !== s.local) copies.set(s.local!, { src: source.src, stmt: sid });
      }
      tx.rewrite(
        v => {
          if (v.op !== 'get' || !v.statement) return;
          const c = before.get(v.statement)?.get(v.imm as number);
          if (!c) return;
          return tx.get(c.src, {
            from: v.id,
            because: [c.stmt],
            note: `${f.locals[v.imm as number].name} = ${f.locals[c.src].name} here`,
          });
        },
        [b],
      );
    }
  },
});
