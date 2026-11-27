// Probe (a side observation while reading bce): bce accepts a dominating `i < buf.length` when the index has the
// same *set* of reaching definitions at the branch and at the check. Equal sets do not mean equal values: here the
// only assignment in the loop lies between the two, and reaches both. Does bce remove the check, and does the
// meaning check then reject the pass?
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { listing } = await import(D + 'typed/listing.js');
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
for (const pass of ['cfg', 'simplify', 'bce', 'guards']) {
  const before = listing(storeOf(p.head.value));
  try {
    const r = await p.apply(pass);
    console.log(`${pass}: changed ${r.changed} ${r.check ?? ''}`);
    if (pass === 'bce' && r.changed) console.log(listing(storeOf(p.head.value)));
  } catch (e) {
    console.log(`${pass}: ${String(e.message).split('\n')[0].slice(0, 300)}`);
    if (pass === 'bce') console.log(before);
  }
}
