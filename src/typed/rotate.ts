/**
 * Loop rotation by header duplication (IRWB-003, agenda item G1). A loop's header that is only its test,
 * `if c goto T else E`, is copied into every block that jumps to it unconditionally: the preheader's copy is the
 * guard (does the loop run at all), the latch's copy is the bottom test (does it run again). The header then has
 * no predecessor and is pruned. An iteration ends with one conditional branch instead of a jump and a branch,
 * once the backend's layout ('loops') puts the latch's exit after it.
 *
 * Valid whatever the test reads or does: it is tail duplication. Each path that jumped to the header runs a copy
 * of it at the point where it would have run the original, once. When both T and E are inside the loop (the
 * first half of an `&&`), the rotated loop has two entries and is irreducible; analyses still terminate (the
 * solver widens at every retreating edge), and passes that need natural loops (licm) no longer see it, so
 * rotation runs after them. The condition may not call or read a result leaf, which keeps leaves next to their
 * calls.
 *
 * The spec is wrapped by `typedPass` in passes.ts (`rotate`), which registers it; this module imports only types
 * from there, so the two do not form a cycle at load time.
 */
import type { TypedPassSpec } from './passes.js';
import type { BlockRec, StmtRec, Store, ValueRec } from './model.js';
import type { Tx } from './tx.js';

const opsOf = (st: Store, id: string, out: string[] = []): string[] => {
  const v = st.get(id) as ValueRec;
  out.push(v.op);
  for (const a of v.args) opsOf(st, a, out);
  return out;
};

const copyTree = (tx: Tx, st: Store, id: string, because: string[]): string => {
  const v = st.get(id) as ValueRec;
  return tx.make(v.op, ...v.args.map(a => copyTree(tx, st, a, because)), {
    imm: v.imm,
    from: id,
    because,
    type: v.type ?? 'i32',
  });
};

export const rotateSpec: TypedPassSpec = {
  name: 'rotate',
  about: 'loop rotation: a header that is only its test is copied into the blocks that jump to it',
  needs: { loops: 'loops' },
  writes: ['stmts', 'values', 'cfg'],
  preserves: [],
  body({ st, f, tx, facts }) {
    const done = new Set<string>();
    for (const L of facts.loops!) {
      const H = L.head;
      if (done.has(H) || H === f.blocks[0].id || !f.blocks.some(b => b.id === H)) continue;
      done.add(H);
      const head = st.get(H) as BlockRec;
      if (head.stmts.length !== 1) continue;
      const test = st.get(head.stmts[0]) as StmtRec;
      if (test.op !== 'br_if' || opsOf(st, test.cond!).some(op => op === 'call' || op === 'result')) continue;
      for (const P of f.blocks) {
        if (P.id === H || !P.stmts.length) continue;
        const last = st.get(P.stmts.at(-1)!) as StmtRec;
        if (last.op !== 'br' || last.to !== H) continue;
        const because = [L.id, H];
        tx.replaceStmt(
          last.id,
          { op: 'br_if', cond: copyTree(tx, st, test.cond!, because), then: test.then, else: test.else },
          { from: test.id, because, note: `loop test duplicated into ${P.id}` },
        );
      }
    }
  },
};
