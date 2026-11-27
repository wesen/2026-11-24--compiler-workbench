/** Split block-local lifetimes so subst can forward expressions through reused VM stack slots. */
import type { StmtRec } from './model.js';
import type { TypedPassSpec } from './passes.js';

export const splitRangesSpec: TypedPassSpec = {
  name: 'split-local-ranges',
  about: 'give short-lived definitions of a multiply assigned scalar separate locals',
  needs: { live: 'liveness', reach: 'reaching' },
  writes: ['locals', 'stmts', 'values'],
  body({ f, st, tx, facts }) {
    const counts = new Map<number, number>();
    for (const b of f.blocks) {
      for (const sid of b.stmts) {
        const s = st.get(sid) as StmtRec;
        if (s.op === 'set') counts.set(s.local!, (counts.get(s.local!) ?? 0) + 1);
      }
    }
    const versions = new Map<string, number>();
    for (const b of f.blocks) {
      // A definition can keep a private name until the next write or until the local dies at block exit.
      const shared = new Set(facts.live!.liveOut(b.id));
      for (const sid of b.stmts.toReversed()) {
        const s = st.get(sid) as StmtRec;
        if (s.op !== 'set') continue;
        const i = s.local!;
        const l = f.locals[i];
        if (!shared.has(i) && counts.get(i)! > 1 && (l.type === 'i32' || l.type === 'f32')) {
          const local = tx.local(l.name + 'Version', { type: l.type, from: sid, because: [sid] });
          versions.set(sid, local);
        }
        shared.delete(i);
      }
    }
    if (!versions.size) return;
    tx.rewrite(v => {
      if (v.op !== 'get') return;
      const defs = facts.reach!.reachingAt(v.statement!, v.imm as number);
      if (defs.length !== 1) return;
      const local = versions.get(defs[0]);
      if (local !== undefined) return tx.get(local, { from: v.id, because: defs });
    });
    for (const [sid, local] of versions) {
      const s = st.get(sid) as StmtRec;
      tx.replaceStmt(sid, { op: 'set', local, value: s.value }, { from: sid, because: [sid] });
    }
  },
};
