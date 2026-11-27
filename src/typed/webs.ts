/**
 * IRWB-036-F: live-range splitting. A local's definitions and uses fall into webs: the definitions that reach one
 * use belong together. When a local has several webs, every web but the one holding the local's initial value (or
 * its parameter value) gets a fresh local. Each use still reads exactly the definitions that reached it, so the
 * meaning is unchanged; the point is that a reused slot (the operand stack's frame0 after `promote`) becomes one
 * single-definition temporary per push, which `subst` can forward.
 *
 * The spec is wrapped by `typedPass` in passes.ts (`webs`), as `rotate` is.
 */
import type { TypedPassSpec } from './passes.js';
import type { StmtRec, ValueRec } from './model.js';

const getsOf = (st: { get(id: string): unknown }, id: string, l: number, out: string[] = []): string[] => {
  const v = st.get(id) as ValueRec;
  if (v.op === 'get' && v.imm === l) out.push(v.id);
  for (const a of v.args) getsOf(st, a, l, out);
  return out;
};

export const websSpec: TypedPassSpec = {
  name: 'webs',
  about:
    'live-range splitting: each web of definitions and uses of a local other than its first gets its own local',
  needs: { reach: 'reaching' },
  writes: ['stmts', 'values', 'locals'],
  preserves: ['cfg', 'dominators'],
  body({ st, f, tx, facts }) {
    const reach = facts.reach!;
    const stmts = f.blocks.flatMap(b => b.stmts.map(sid => st.get(sid) as StmtRec));
    const renames = new Map<string, number>(); // set statement or get value -> new local
    for (let l = 0; l < f.locals.length; l++) {
      if (f.locals[l].param || f.locals[l].type === 'f32') continue;
      const defs = stmts.filter(s => s.op === 'set' && s.local === l).map(s => s.id);
      if (defs.length < 2) continue;
      // union-find over definitions (and the initial value)
      const parent = new Map<string, string>([...defs, `init:${l}`].map(d => [d, d]));
      const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
      const uses: { vid: string; defs: string[] }[] = [];
      for (const s of stmts)
        for (const k of ['value', 'cond', 'addr'] as const)
          if (s[k])
            for (const vid of getsOf(st, s[k]!, l)) {
              const ds = reach.reachingAt(s.id, l).map(d => (parent.has(d) ? d : `init:${l}`));
              uses.push({ vid, defs: ds });
              for (const d of ds.slice(1)) parent.set(find(d), find(ds[0]));
            }
      const root = find(`init:${l}`);
      const webs = new Map<string, number>();
      const web = (d: string) => {
        const r = find(d);
        if (r === root) return null;
        let n = webs.get(r);
        if (n === undefined)
          webs.set(
            r,
            (n = tx.local(f.locals[l].name, { because: [`fact:reaching(${f.name})@r${tx.rev - 1}`] })),
          );
        return n;
      };
      for (const d of defs) {
        const n = web(d);
        if (n !== null) renames.set(d, n);
      }
      for (const u of uses) {
        const n = u.defs.length ? web(u.defs[0]) : null;
        if (n !== null) renames.set(u.vid, n);
      }
    }
    if (!renames.size) return;
    const because = [`fact:reaching(${f.name})@r${tx.rev - 1}`];
    tx.rewrite(v => {
      const n = renames.get(v.id);
      return n === undefined ? undefined : tx.get(n, { because, note: 'its own web' });
    });
    for (const s of stmts) {
      const n = renames.get(s.id);
      if (n !== undefined) tx.replaceStmt(s.id, { op: 'set', local: n, value: s.value }, { because });
    }
  },
};
