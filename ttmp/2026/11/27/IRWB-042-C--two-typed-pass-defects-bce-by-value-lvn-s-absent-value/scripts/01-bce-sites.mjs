// IRWB-042-C probe 1 (F36): every bce candidate site in the corpus, with the facts the pass decides on.
//   node 01-bce-sites.mjs [project...]      default: every corpus project
// For each function of each project, after the passes the pipeline runs before bce, print every block ending in a
// bounds check `geu(idx, buf.length) -> trap` whose dominator chain holds a `idx < buf.length` branch: the reaching
// definitions of the index (and of the buffer) at the branch and at the check, the value ids of the two reads, and
// whether the branch passes the rule bce has today (equal sets) or a rule over values (equal singleton sets).
// The facts come from `p.fact`, which gives the dataflow result; reachView and domView are rebuilt here as the pass
// body sees them (src/typed/analyses.ts).
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { projectIds, projectFiles } = await import('../../../../../../tools/corpus.mjs');
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { PIPELINES } = await import(D + 'typed/passes.js');
const { ssaOf } = await import(D + 'typed/ssa.js');

const lastStmt = (st, b) => (b.stmts?.length ? st.get(b.stmts.at(-1)) : undefined);
const isSet = s => s.op === 'set';
// the definitions of a local that reach each statement (analyses.ts: reachView)
const reachView = (st, fn, r) => {
  const before = new Map();
  const localOf = d =>
    d.startsWith('param:') || d.startsWith('init:') ? +d.split(':')[1] : st.get(d).local;
  for (const bid of fn.blocks) {
    const now = new Set(r.in[bid] ?? []);
    for (const sid of (st.get(bid).stmts ?? [])) {
      before.set(sid, new Set(now));
      const s = st.get(sid);
      if (isSet(s)) {
        for (const d of [...now]) if (localOf(d) === s.local) now.delete(d);
        now.add(sid);
      }
    }
  }
  return (sid, l) => [...(before.get(sid) ?? [])].filter(d => localOf(d) === l);
};

const sites = [];
const rule = { set: 0, singleton: 0, values: 0 };
for (const id of process.argv.length > 2 ? process.argv.slice(2) : projectIds()) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  if (p.status !== 'ok') {
    console.log(`${id}: ${p.status}`);
    continue;
  }
  try {
    for (const pass of PIPELINES.O2.slice(0, PIPELINES.O2.indexOf('bce')))
      await p.apply(pass, { count: 3, check: false });
  } catch (e) {
    console.log(`${id}: pipeline failed: ${e.message}`);
    continue;
  }
  const st = storeOf(p.head.value);
  for (const fn of Object.values(p.head.value.fns)) {
    const domRaw = (await p.fact('dominators', fn.name)).value;
    const idom = new Map(Object.entries(domRaw.idom));
    const reaches = reachView(st, fn, (await p.fact('reaching', fn.name)).value);
    const ranges = (await p.fact('ranges', fn.name)).value;
    const ssa = ssaOf(st, st.fn(fn.name));
    const nameOf = vid => ssa.uses[vid];
    const dominates = (a, b) => {
      for (;;) {
        if (a === b) return true;
        const x = idom.get(b);
        if (!x || x === b) return false;
        b = x;
      }
    };
    const at = (sid, l) => reaches(sid, l).sort();
    // resolve a read through single copies: t = x -> x (bce's own `resolve`)
    const resolve = (sid, vid) => {
      const v = st.get(vid);
      if (v.op !== 'get') return { id: vid, local: null, sid };
      const defs = reaches(sid, v.imm);
      if (defs.length === 1 && defs[0].startsWith('s:')) {
        const d = st.get(defs[0]),
          dv = st.get(d.value);
        if (dv.op === 'get') return { id: d.value, local: dv.imm, sid: d.id, via: d.id };
      }
      return { id: vid, local: v.imm, sid };
    };
    const isLength = (vid, buf) => {
      const v = st.get(vid);
      return (
        v.op === 'load' &&
        v.imm === 0 &&
        st.get(v.args[0]).op === 'get' &&
        (buf === undefined || st.get(v.args[0]).imm === buf)
      );
    };
    for (const bid of fn.blocks) {
      const b = st.get(bid);
      const last = lastStmt(st, b);
      if (!last || last.op !== 'br_if') continue;
      const c = st.get(last.cond);
      if (c.op !== 'geu' || !isLength(c.args[1])) continue;
      const trapB = st.get(last.then);
      if (!trapB.stmts?.length || st.get(trapB.stmts[0]).op !== 'trap') continue;
      const idx = resolve(last.id, c.args[0]);
      if (idx.local === null) continue;
      const buf = st.get(st.get(c.args[1]).args[0]).imm;
      const local = idx.local;
      for (let d = idom.get(b.id), child = b.id; d && d !== child; child = d, d = idom.get(d)) {
        const t = lastStmt(st, st.get(d));
        if (!t || t.op !== 'br_if') continue;
        let cond = st.get(t.cond),
          onTrue = true;
        if (cond.op === 'eqz') {
          cond = st.get(cond.args[0]);
          onTrue = false;
        }
        if (cond.op === 'ge') onTrue = !onTrue;
        else if (cond.op !== 'lt') continue;
        const arm = onTrue ? t.then : t.else;
        if (!dominates(arm, b.id)) continue;
        const x = st.get(cond.args[0]);
        if (x.op !== 'get' || x.imm !== local || !isLength(cond.args[1], buf)) continue;
        const gi = at(t.id, local),
          ci = at(last.id, local),
          gb = at(t.id, buf),
          cb = at(last.id, buf);
        const name = l => fn.locals[l].name;
        const set = gi.join() === ci.join() && gb.join() === cb.join();
        const single = set && gi.length === 1 && gb.length === 1;
        const guardIdxName = nameOf(cond.args[0]),
          checkIdxName = nameOf(idx.id),
          guardBufName = nameOf(st.get(cond.args[1]).args[0]),
          checkBufName = nameOf(st.get(c.args[1]).args[0]);
        const values = guardIdxName !== undefined && guardIdxName === checkIdxName &&
          guardBufName !== undefined && guardBufName === checkBufName;
        if (set) rule.set++;
        if (single) rule.singleton++;
        if (values) rule.values++;
        const grep = /bce-probe/.test(id);
        if (!grep)
          console.log(
            [
              `${id}/${fn.name}`,
              `guard ${t.id} (${cond.op} ${onTrue ? 'then' : 'else'} -> ${arm})  check ${last.id}`,
              `index ${name(local)}: at guard {${gi.join(' ')}${gi.every(d => d.startsWith('s:')) ? ` = v:${gi.map(d => st.get(d).value).join(' v:')}` : ''}} at check {${ci.join(' ')}${ci.every(d => d.startsWith('s:')) ? ` = v:${ci.map(d => st.get(d).value).join(' v:')}` : ''}}`,
              `reads: guard ${cond.args[0]} check ${c.args[0]}${idx.via ? ` (through copy ${idx.via} = ${idx.id})` : ''}`,
              `buffer ${name(buf)}: {${gb.join(' ')}} / {${cb.join(' ')}}`,
              `bounds ${name(local)}: block of guard ${JSON.stringify(ranges.in[t.id]?.[local])} block of check ${JSON.stringify(ranges.in[b.id]?.[local])}`,
              `ssa names: index ${guardIdxName} / ${checkIdxName}  buffer ${guardBufName} / ${checkBufName}`,
              `rule: equal-sets ${set}  equal-singleton ${single}  equal-values ${values}`,
            ].join('\n  '),
          );
        sites.push({ id, fn: fn.name, guard: t.id, check: last.id, local: name(local), set, single, values });
      }
    }
  }
}
console.log(`\n${sites.length} candidate sites; equal-sets would fire on ${rule.set}, equal-singleton on ${rule.singleton}, equal-values on ${rule.values}`);
