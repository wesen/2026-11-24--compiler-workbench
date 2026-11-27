// Reproduce F36 (bce removes a check it must keep) and F38 (a second lvn throws `absent`).
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { listing } = await import(D + 'typed/listing.js');
const { PIPELINES } = await import(D + 'typed/passes.js');
const { projectFiles } = await import('../../../../../../tools/corpus.mjs');

// --- F36 ---
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
console.log('--- walk after cfg+simplify');
console.log(listing(storeOf(p.head.value), 'walk'));
try {
  const r = await p.apply('bce');
  console.log(`F36: bce changed ${r.changed} (meaning check accepted it)`);
} catch (e) {
  console.log(`F36: bce rejected: ${String(e.message).split('\n')[0].slice(0, 200)}`);
}

// --- F38 ---
const q = Program.fromProject(projectSource('regex-nfa', projectFiles('regex-nfa')));
if (q.status !== 'ok') throw new Error(JSON.stringify(q.error));
const speed = [...PIPELINES.speed];
speed.splice(speed.indexOf('rotate'), 0, 'lvn');
try {
  const r = await q.pipeline(speed, { count: 3 });
  console.log('F38: pipeline finished, rejected:', r.steps.filter(s => s.rejected).map(s => s.pass));
} catch (e) {
  console.log('F38: threw:', String(e.message).split('\n')[0].slice(0, 200));
}
