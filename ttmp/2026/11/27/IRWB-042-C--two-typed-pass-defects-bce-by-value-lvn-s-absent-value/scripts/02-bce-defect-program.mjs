// IRWB-042-C probe 2 (F36): the program of the test, before and after the fix's criterion.
//   node 02-bce-defect-program.mjs
// Runs cfg and simplify on the loop whose only assignment to `i` lies between the guard `i < buf.length` and the
// check `buf.charCodeAt(i)`, then prints the block listing and, for the guard and the check, the reaching
// definitions of `i` and of `buf` (what bce compared before) and the SSA names of the two reads (what it compares
// now). Then applies bce and reports whether the check survives.
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { listing } = await import(D + 'typed/listing.js');
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
const p = Program.fromProject(
  projectSource('bce-probe', {
    'main.typed': source,
    'project.json': JSON.stringify({
      inputs: { walk: { buf: { buffer: [1, 4], cell: [400, 600] }, c: { bool: true } } },
    }),
  }),
);
if (p.status !== 'ok') throw new Error(JSON.stringify(p.error));
await p.apply('cfg', { check: false });
await p.apply('simplify', { check: false });
const st = storeOf(p.head.value);
console.log(listing(st));
const f = st.fn('walk');
const ssa = ssaOf(st, f);
const reach = (await p.fact('reaching', 'walk')).value;
const before = new Map();
const localOf = d =>
  d.startsWith('param:') || d.startsWith('init:') ? +d.split(':')[1] : st.get(d).local;
for (const b of f.blocks) {
  const now = new Set(reach.in[b.id] ?? []);
  for (const sid of b.stmts) {
    before.set(sid, [...now].sort().join(' '));
    const s = st.get(sid);
    if (s.op === 'set') {
      for (const d of [...now]) if (localOf(d) === s.local) now.delete(d);
      now.add(sid);
    }
  }
}
// s:walk.3 is the guard (`i >= load32[buf+0]` -> return), s:walk.9 the check (`t4 >=u ...` -> trap)
const i = f.locals.findIndex(l => l.name === 'i'),
  t4 = f.locals.findIndex(l => l.name === 't4');
const setOf = (sid, l) => [...new Set(before.get(sid).split(' '))].filter(d => d && localOf(d) === l).join(' ');
console.log(`i reaches the guard  {${setOf('s:walk.3', i)}}`);
console.log(`i reaches the check  {${setOf('s:walk.9', i)}}   (equal sets: the two reads are still not the same)`);
const checkRead = st.get(st.get('s:walk.9').cond).args[0];
console.log(`copy t4 = i at s:walk.8 reads ${ssa.uses[st.get('s:walk.8').value]}, the guard reads ${ssa.uses[st.get(st.get('s:walk.3').cond).args[0]]} (local ${st.get(checkRead).imm} at the check)`);
let r;
try {
  r = await p.apply('bce');
  console.log(`bce: changed ${r.changed}, check ${JSON.stringify(r.check ?? 'none')}`);
} catch (e) {
  console.log(`bce: ${String(e.message).split('\n')[0]}`);
}
console.log(listing(storeOf(p.head.value)));
