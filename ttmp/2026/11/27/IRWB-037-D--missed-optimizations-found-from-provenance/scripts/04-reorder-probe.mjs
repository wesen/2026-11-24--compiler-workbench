// Probe: what would a block-ordering pass buy under the *default* backend layout ('source')?
// For each function, order the blocks by the backend's own static-frequency chain construction
// (frequency.ts + layout.ts, the `chains` option's order, which the backend cannot use in the IR), rebuild the
// value with the blocks in that order and lower it with default options. Compares instructions and bytes before
// and after for every corpus project at r0 and after each pipeline, plus the three benchmark calls.
// usage: node 04-reorder-probe.mjs [--json] [id...]
import { projectIds, projectFiles, projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor({ reference: true });
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { casesFrom, benchCase } = await import(D + 'typed/evaluate.js');
const { lowerToImage, runImage } = await import(D + 'typed/backend/index.js');
const { blockFrequencies } = await import(D + 'typed/backend/frequency.js');
const { layoutBlocks } = await import(D + 'typed/backend/layout.js');
const { createIRArtifact } = await import(D + 'framework/ir/index.js');
const { BlocksIR, blocksAdapter } = await import(D + 'typed/ir.js');

/** The same value with every function's blocks in the estimated order. */
function reordered(art) {
  const st = storeOf(art.value), native = JSON.parse(JSON.stringify(st.toNative()));
  for (const f of Object.values(native.fns)) {
    const fr = blockFrequencies(st, st.fn(f.name));
    const order = layoutBlocks(st, st.fn(f.name), fr);
    const pos = new Map(order.map((b, i) => [b, i]));
    f.blocks = [...f.blocks].sort((a, b) => pos.get(a) - pos.get(b));
  }
  return createIRArtifact(blocksAdapter, art.id, native);
}

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const only = argv.filter(a => !a.startsWith('--'));

function instructions(art, inputs, fns) {
  const { image } = lowerToImage(art), st = storeOf(art.value);
  let n = 0;
  for (const fn of fns)
    for (const c of casesFrom(st, fn, { count: 10, seed: 7, inputs: inputs[fn] ?? {} })) {
      const r = runImage(image, fn, c.args, c.memory, { limit: 2e5, counts: false });
      n += r.limit || !Number.isFinite(r.steps) ? 2e5 : r.steps;
    }
  return { n, bytes: image.value.bytes };
}

const rows = {};
for (const id of only.length ? only : projectIds()) {
  const project = projectSource(id, projectFiles(id));
  const p = Program.fromProject(project);
  const row = {};
  for (const pipeline of ['r0', 'O2', 'speed']) {
    if (pipeline !== 'r0') await p.pipeline(pipeline);
    const fns = p.fns();
    const before = instructions(p.head, project.meta.inputs, fns);
    const after = instructions(reordered(p.head), project.meta.inputs, fns);
    row[pipeline] = { before: before.n, after: after.n, bytesBefore: before.bytes, bytesAfter: after.bytes };
  }
  rows[id] = row;
  const cell = pl => `${row[pl].before}${row[pl].after === row[pl].before ? '' : ' -> ' + row[pl].after}`;
  console.log(`${id.padEnd(22)} r0 ${cell('r0').padStart(18)}  O2 ${cell('O2').padStart(18)}  speed ${cell('speed').padStart(18)}`);
}
if (json) console.log(JSON.stringify(rows, null, 1));

// the three benchmark calls the brief names, at the last revision
const bench = [
  ['regex-nfa', 'speed', 'regexMatch', { pattern: { string: '[a-c]*[b-d]*a*d' }, text: { string: 'abccabbd' } }],
  [
    'lz-roundtrip',
    'speed',
    'roundTrip',
    { input: { cells: [65, 65, 66, 66, 65, 65, 66, ...Array(17).fill(65)] }, chainLimit: 3 },
  ],
];
for (const [id, pipeline, fn, input] of bench) {
  const project = projectAllFiles(id) && projectSource(id, projectFiles(id));
  const p = Program.fromProject(project);
  await p.pipeline(pipeline);
  const call = benchCase(storeOf(p.origin.value), fn, input);
  const count = art => {
    const { image } = lowerToImage(art);
    const r = runImage(image, fn, call.args, call.memory, { counts: false, limit: 2e5 });
    return r.steps;
  };
  console.log(`${id} ${pipeline} ${fn}: ${count(p.head)} -> ${count(reordered(p.head))}`);
}
void BlocksIR;
