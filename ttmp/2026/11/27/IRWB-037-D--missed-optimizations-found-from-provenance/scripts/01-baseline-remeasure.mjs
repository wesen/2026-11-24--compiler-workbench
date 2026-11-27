// Re-measure the three benchmarks the brief names, as IRWB-013..017 took them, before any change:
//  - regex-nfa: one benchmark call `/[a-c]*[b-d]*a*d/` on "abccabbd", r0 / speed / reference, default backend
//  - lz-roundtrip: 100 seed-7 cases per function, r0 / speed with chains+coalesce+homes / reference
//  - chess-search: `node corpus/projects/chess-search/scripts/fixtures.mjs measure` prints the same three images
// The diary figures of IRWB-014 are the `roundTrip` row. usage: node 01-baseline-remeasure.mjs [--json]
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor({ reference: true });
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { benchCase, casesFrom, readBuffer } = await import(D + 'typed/evaluate.js');
const { imageFromCode, lowerToImage, runImage } = await import(D + 'typed/backend/index.js');

const json = process.argv.includes('--json');
const TUNED = { chains: true, coalesce: true, homes: true };

async function imagesOf(id, options) {
  const files = projectAllFiles(id), project = projectSource(id, files);
  const program = Program.fromProject(project);
  if (program.status !== 'ok') throw new Error(`${id}: ${program.status}`);
  await program.pipeline(project.meta.pipeline);
  const { image, entries, signatures } = globalThis.typedRv32.compile(project.source, [], undefined);
  return {
    project,
    program,
    r0: lowerToImage(program.origin).image,
    speed: lowerToImage(program.head, options).image,
    reference: imageFromCode(id, image, entries, signatures),
  };
}

const run = (image, fn, args, memory) => {
  const r = runImage(image, fn, args, memory, { limit: 2e5, counts: false });
  if (r.trap || r.limit || r.fault) throw new Error(`${fn}: trap=${r.trap} limit=${r.limit} fault=${r.fault}`);
  return r.steps;
};

const out = {};

// ---------- regex-nfa: the benchmark call of IRWB-015's test ----------
{
  const im = await imagesOf('regex-nfa', {});
  const store = storeOf(im.program.origin.value);
  const k = benchCase(store, 'regexMatch', {
    pattern: { string: '[a-c]*[b-d]*a*d' },
    text: { string: 'abccabbd' },
  });
  out['regex-nfa'] = {
    call: 'regexMatch(/[a-c]*[b-d]*a*d/, "abccabbd")',
    r0: run(im.r0, 'regexMatch', k.args, k.memory),
    speed: run(im.speed, 'regexMatch', k.args, k.memory),
    reference: run(im.reference, 'regexMatch', k.args, k.memory),
  };
}

// ---------- lz-roundtrip: 100 seed-7 cases of every function ----------
{
  const im = await imagesOf('lz-roundtrip', TUNED);
  const speedStore = storeOf(im.program.head.value);
  const totals = { r0: 0, speed: 0, reference: 0, cases: 0 };
  for (const fn of im.program.fns()) {
    const row = { r0: 0, speed: 0, reference: 0, cases: 0 };
    for (const c of casesFrom(speedStore, fn, { count: 100, seed: 7, inputs: im.project.meta.inputs[fn] ?? {} })) {
      row.cases++;
      row.r0 += run(im.r0, c.fn, c.args, c.memory);
      row.speed += run(im.speed, c.fn, c.args, c.memory);
      row.reference += run(im.reference, c.fn, c.args, c.memory);
    }
    for (const k of ['r0', 'speed', 'reference', 'cases']) totals[k] += row[k];
    out[`lz-roundtrip ${fn}`] = { call: `${fn}: 100 seed-7 cases`, ...row };
  }
  out['lz-roundtrip'] = { call: '100 seed-7 cases of every function, speed with chains+coalesce+homes', ...totals };
}

if (json) console.log(JSON.stringify(out, null, 1));
else
  for (const [id, row] of Object.entries(out))
    console.log(
      `${id.padEnd(26)} ${String(row.r0).padStart(8)} r0  ${String(row.speed).padStart(8)} speed  ${String(row.reference).padStart(8)} reference   ${row.call}`,
    );
