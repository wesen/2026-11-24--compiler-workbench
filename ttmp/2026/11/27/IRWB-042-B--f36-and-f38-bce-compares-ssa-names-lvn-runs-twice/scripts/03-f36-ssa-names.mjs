// Evidence for the F36 fix: in IRWB-037-G's bce-probe program (after cfg+simplify), the sets of reaching
// definitions of `i` are EQUAL at the guard (s:walk.3, `if (i >= load32[buf+0])`) and at the check's copy
// (s:walk.8, `t4 = i`) — the only assignment s:walk.5 lies between them and reaches both — but the SSA names
// differ: the loop-header phi against the if-join phi. Equal sets are not equal values; equal names are.
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { ssaOf } = await import(D + 'typed/ssa.js');
const source = `
function walk(buf: buffer, c: bool): i32 {
    let i = 0;
    let s = 0;
    while (i < buf.length) {
        if (c) {
            i = i + 1;
        }
        s = s + buf.charCodeAt(i);
        if (s > 1000) {
            break;
        }
    }
    return s;
}`;
const p = Program.fromProject(projectSource('bce-probe', {
  'main.typed': source,
  'project.json': JSON.stringify({ inputs: { walk: { buf: { buffer: [1, 4], cell: [400, 600] }, c: { bool: true } } } }),
}));
if (p.status !== 'ok') throw new Error(JSON.stringify(p.error));
await p.apply('cfg');
await p.apply('simplify');
const st = storeOf(p.head.value), f = st.fns.get('walk');
const ssa = ssaOf(st, f);
const i = f.locals.findIndex(l => l.name === 'i');
// reaching definitions, as reachView computes them: the block's in-set, threaded through the block's sets
const region = (await p.fact('reaching', 'walk')).value;
const reach = (bid, upTo) => {
  const now = new Set(region.in[bid] ?? []);
  for (const sid of (st.get(bid) ).stmts) {
    if (sid === upTo) return [...now].filter(d => !d.indexOf ? true : true).filter(d => (d.startsWith('init:') || d.startsWith('param:') ? +d.split(':')[1] : st.get(d).local) === i);
    const s = st.get(sid);
    if (s.op === 'set') {
      for (const d of [...now]) if ((d.startsWith('init:') || d.startsWith('param:') ? +d.split(':')[1] : st.get(d).local) === s.local) now.delete(d);
      now.add(sid);
    }
  }
};
// s:walk.3 is the only statement of bb:walk.1; s:walk.8 is the first statement of bb:walk.6
console.log(`reaching defs of i at the guard (s:walk.3): ${reach('bb:walk.1', 's:walk.3').sort().join(' ')}`);
console.log(`reaching defs of i at the copy  (s:walk.8): ${reach('bb:walk.6', 's:walk.8').sort().join(' ')}`);
// the SSA names: the guard's cond reads i directly; the check's index is the copy t4 = i
const guardGet = st.get(st.get('s:walk.3').cond).args[0];
const copyValue = st.get('s:walk.8').value;
const chain = v => {
  const out = [];
  for (let n = ssa.uses[v]; n && !out.includes(n); ) {
    out.push(n);
    const d = ssa.names[n];
    if (d.kind === 'set' && st.get(d.value).op === 'get') n = ssa.uses[st.get(d.value).id];
    else break;
  }
  return out.join(' -> ');
};
console.log(`SSA name of i at the guard:                    ${chain(guardGet)}`);
console.log(`SSA name of the check's index (t4 = i):        ${chain(copyValue)}`);
