// The measurement table: RV32 instructions at n = 12, seed = 8 and function bytes, for the general VM (r0, speed),
// the automatically specialized VM (pe + RESIDUAL_PIPELINE, and two shorter cleanups), and the hand-specialized
// loops of tests/typed/bytecode-vm.test.mjs; then the smallest pe budget that still succeeds, and what happens below.
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor({ reference: true });
const D = '../../../../../../dist/typed/';
const { Program } = await import(D + 'program.js');
const { projectSource } = await import(D + 'project.js');
const { storeOf } = await import(D + 'ir.js');
const { benchCase } = await import(D + 'evaluate.js');
const { lowerToImage, runImage } = await import(D + 'backend/index.js');
const { BindingsIR } = await import(D + 'specialize.js');
const { pe, RESIDUAL_PIPELINE } = await import(D + 'pe.js');
const { PIPELINES } = await import(D + 'passes.js');
const { createArtifact } = await import('../../../../../../dist/framework/contracts/index.js');

const backend = { coalesce: true };
const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const cells = project.meta.inputs.runVm.code.cells;
const N = 12, SEED = 8;
const runFn = (art, fn, bench) => {
  const st = storeOf(art.value);
  const c = benchCase(st, fn, bench);
  const img = lowerToImage(art, backend).image;
  const r = runImage(img, fn, c.args, c.memory, { counts: false });
  return { result: r.result, instructions: r.steps, bytes: img.value.fns[fn].bytes };
};
const bindingsFor = entry => createArtifact(BindingsIR, `bytecode-vm@${entry}`, {
  formatVersion: 1, source: 'bytecode-vm',
  bindings: [
    { fn: 'runVm', param: 'code', cells, entity: 'bytecode-vm:project.json#inputs.runVm.code' },
    { fn: 'runVm', param: 'entry', value: entry, entity: `bytecode-vm:entry/${entry}` },
  ],
});
async function specialized(entry, after, budget) {
  const p = Program.fromProject(project), bindings = bindingsFor(entry);
  await p.specialize(bindings);
  await p.apply(pe, { params: { bindings, ...(budget ? { budget } : {}) } });
  const pe1 = p.revisions.at(-1).edits.find(e => e.kind === 'pe');
  const pl = await p.pipeline(after);
  if (pl.steps.some(s => s.rejected)) throw new Error('rejected: ' + JSON.stringify(pl.steps.filter(s => s.rejected)));
  return { p, pe: pe1 };
}

// the general VM
const general = {};
{
  const p = Program.fromProject(project);
  const r0 = p.origin;
  await p.pipeline('speed');
  for (const entry of [0, 34]) {
    const bench = { code: { cells }, entry, n: N, seed: SEED };
    general[entry] = { r0: runFn(r0, 'runVm', bench), speed: runFn(p.head, 'runVm', bench) };
  }
}
// the hand-specialized loops (the source of tests/typed/bytecode-vm.test.mjs)
const handSource = `
function seededFib(n: i32, seed: i32): i32 {
    let a = 0;
    let b = seed;
    for (let remaining = n; remaining > 0; remaining = remaining - 1) {
        const next = a + b;
        a = b;
        b = next;
    }
    return a;
}

function rollingChecksum(n: i32, seed: i32): i32 {
    let h = seed;
    for (let remaining = n; remaining > 0; remaining = remaining - 1) {
        h = h * 33 + remaining;
    }
    return h;
}
`;
const scalar = { n: [0, 12], seed: [-8, 8] };
const hp = Program.fromProject(projectSource('bytecode-vm-specialized', {
  'main.typed': handSource,
  'project.json': JSON.stringify({ pipeline: 'speed', inputs: { seededFib: scalar, rollingChecksum: scalar } }),
}));
await hp.pipeline('speed');
const hand = { 0: runFn(hp.head, 'seededFib', { n: N, seed: SEED }), 34: runFn(hp.head, 'rollingChecksum', { n: N, seed: SEED }) };

const cleanups = {
  'promote+speed': ['cfg', 'promote', ...PIPELINES.speed],
  'webs+speed': ['cfg', 'promote', 'webs', ...PIPELINES.speed],
  'RESIDUAL_PIPELINE': RESIDUAL_PIPELINE,
};
const rows = [];
for (const entry of [0, 34]) {
  const row = { entry, r0: general[entry].r0, speed: general[entry].speed, hand: hand[entry] };
  for (const [name, after] of Object.entries(cleanups)) {
    const { p, pe: e } = await specialized(entry, after);
    row[name] = { ...runFn(p.head, 'runVm', { code: { cells }, entry, n: N, seed: SEED }), variants: e.variants, residual: e.statements };
  }
  rows.push(row);
}
console.log(JSON.stringify(rows, null, 1));

// the smallest budget that succeeds, and the refusal just below it
for (const entry of [0, 34]) {
  let lo = 1, hi = 200;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    try { await specialized(entry, [], mid); hi = mid; } catch { lo = mid + 1; }
  }
  let refusal;
  try { await specialized(entry, [], lo - 1); } catch (e) { refusal = e.message.split('\n')[0]; }
  console.log(JSON.stringify({ entry, smallestBudget: lo, below: refusal }));
}
