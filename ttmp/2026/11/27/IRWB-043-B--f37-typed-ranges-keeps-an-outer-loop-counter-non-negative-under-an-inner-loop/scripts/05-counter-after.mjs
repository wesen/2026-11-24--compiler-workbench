// Probe: the guards.test.mjs COUNTER scenario after the threshold widening: what strength and guards now do.
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { listing } = await import(D + 'typed/listing.js');
const { storeOf } = await import(D + 'typed/ir.js');

const COUNTER = `
function sum(n: i32): i32 {
    let s = 0;
    for (let d = 0; d < 64; d = d + 1) {
        for (let j = 0; j < n; j = j + 1) {
            s = s + j;
        }
        s = s + d / 8 + d % 8;
    }
    return s;
}
function wander(n: i32, back: bool): i32 {
    let s = 0;
    let d = 0;
    while (d < 64) {
        s = s + d / 8;
        if (back) {
            d = d - 3;
        }
        d = d + 2;
        if (s > n) {
            break;
        }
    }
    return s;
}`;
const p = Program.fromProject(
  projectSource('counter', { 'main.typed': COUNTER, 'project.json': JSON.stringify({ inputs: { sum: { n: [0, 3] }, wander: { n: [0, 40], back: { bool: true } } } }) }),
);
for (const pass of ['cfg', 'simplify']) await p.apply(pass);
const s = await p.apply('strength');
console.log('strength changed:', s.changed, 'edits:', JSON.stringify(s).slice(0,120));
const g = await p.apply('guards');
console.log('guards changed:', g.changed, 'edits:', JSON.stringify(g).slice(0,120));
console.log(listing(storeOf(p.head.value), 'sum'));
console.log(listing(storeOf(p.head.value), 'wander'));
