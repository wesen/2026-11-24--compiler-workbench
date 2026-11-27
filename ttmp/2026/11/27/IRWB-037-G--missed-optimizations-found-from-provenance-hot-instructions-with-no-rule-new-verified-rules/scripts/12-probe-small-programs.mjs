// Probe: the four new passes on small programs, with listings before and after and the check verdicts
// (what the tests in tests/typed/guards.test.mjs then assert). usage: node 12-probe-small-programs.mjs [name]
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { listing } = await import(D + 'typed/listing.js');

export const PROGRAMS = {
  and: {
    passes: ['cfg', 'thread', 'constprop', 'cfg', 'dce', 'subst-mem', 'dce', 'cfg'],
    inputs: { both: { a: [-3, 3], b: [-3, 3] } },
    source: `
function both(a: i32, b: i32): i32 {
    let r = 0;
    if (a > 0 && b > 0) {
        r = 1;
    }
    return r;
}`,
  },
  checks: {
    passes: ['cfg', 'guards', 'cfg'],
    inputs: { fill: { n: [0, 12] } },
    tape: true,
    source: `
function fill(n: i32): i32 {
    const cells = new Int32Array(9);
    const rows = new Int32Array(45);
    let sum = 0;
    for (let state = 0; state < n; state = state + 1) {
        const row = 5 * state;
        cells[state] = cells[state] + 1;
        rows[row + 1] = state;
        sum = sum + rows[row + 4] + cells[state];
    }
    return sum;
}`,
  },
  moved: {
    passes: ['cfg', 'guards', 'cfg'],
    inputs: { hop: { start: [0, 12], k: [0, 12] } },
    tape: true,
    source: `
function hop(start: i32, k: i32): i32 {
    const cells = new Int32Array(9);
    let i = start;
    cells[i] = 1;
    i = i + k;
    cells[i] = 2;
    return cells[0];
}`,
  },
  copy: {
    passes: ['copies', 'dce'],
    inputs: { twice: { a: [-9, 9] }, stale: { x: [-9, 9] } },
    source: `
function twice(a: i32): i32 {
    let b = a;
    return b + b;
}
function stale(x: i32): i32 {
    let a = x * 3;
    let b = a;
    a = a + 1;
    return b + a;
}`,
  },
};
const only = process.argv[2];
for (const [name, t] of Object.entries(PROGRAMS)) {
  if (only && only !== name) continue;
  const p = Program.fromProject(projectSource(name, { 'main.typed': t.source, 'project.json': JSON.stringify({ inputs: t.inputs, ...(t.tape ? { ingest: { tape: true } } : {}) }) }));
  if (p.status !== 'ok') { console.log(name, p.status, JSON.stringify(p.error)); continue; }
  console.log(`\n===== ${name}, r0\n${listing(storeOf(p.head.value))}`);
  for (const pass of t.passes) {
    const r = await p.apply(pass);
    console.log(`  ${pass}: changed ${r.changed}, check ${r.check ?? ''}, edits ${r.edits ?? ''}`);
  }
  console.log(`===== ${name}, after ${t.passes.join(', ')}\n${listing(storeOf(p.head.value))}`);
}
