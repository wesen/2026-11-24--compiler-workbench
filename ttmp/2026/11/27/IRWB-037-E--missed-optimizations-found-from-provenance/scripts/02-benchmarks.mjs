// The three named benchmarks, measured as the tickets of IRWB-013..017 measured them:
//   regex-nfa: one call, regexMatch('[a-c]*[b-d]*a*d', 'abccabbd'), default backend options;
//   lz-roundtrip: 100 seed-7 wrapper cases, tuned backend (chains, coalesce, homes);
//   chess-search: the quiet-mate-in-two fixture at depth 3, tuned backend.
// Each at r0, after speed, and with the reference compiler's image.
// usage: node 02-benchmarks.mjs out.json
import { writeFileSync } from 'node:fs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor({ reference: true });
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { casesFrom, benchCase } = await import(D + 'typed/evaluate.js');
const { lowerToImage, runImage, imageFromCode } = await import(D + 'typed/backend/index.js');
const TUNED = { chains: true, coalesce: true, homes: true };

const steps = (image, fn, args, memory, options) => {
  const r = runImage(image, fn, args, memory, { limit: 3e7, counts: false });
  if (r.limit || r.trap || r.fault) throw new Error(`${fn}: limit=${r.limit} trap=${r.trap} fault=${r.fault}`);
  return r.steps;
};
const refImage = (p, id) => {
  const r = globalThis.typedRv32.compile(p.source, [], undefined);
  return imageFromCode(id, r.image, r.entries, r.signatures);
};
const out = {};
for (const id of ['regex-nfa', 'lz-roundtrip', 'chess-search']) {
  const ps = projectSource(id, projectFiles(id));
  const row = {};
  const p0 = Program.fromProject(ps);
  const st = storeOf(p0.origin.value);
  const ref = refImage(ps, id);
  const runSpeed = async () => {
    const p = Program.fromProject(ps);
    const run = await p.pipeline('speed', { count: 5 });
    const rejected = run.steps.filter(s => s.rejected).map(s => s.pass);
    return { p, rejected };
  };
  if (id === 'regex-nfa') {
    const call = benchCase(st, 'regexMatch', {
      pattern: { string: '[a-c]*[b-d]*a*d' },
      text: { string: 'abccabbd' },
    });
    const r0 = lowerToImage(p0.origin).image;
    const { p, rejected } = await runSpeed();
    const sp = lowerToImage(p.head).image;
    row.regexMatch = {
      r0: steps(r0, 'regexMatch', call.args, call.memory, {}),
      speed: steps(sp, 'regexMatch', call.args, call.memory, {}),
      reference: steps(ref, 'regexMatch', call.args, call.memory, {}),
      ...(rejected.length ? { rejected } : {}),
    };
  }
  if (id === 'lz-roundtrip') {
    const cases = casesFrom(st, 'roundTrip', { count: 100, seed: 7, inputs: ps.meta.inputs['roundTrip'] ?? {} });
    const sum = image => {
      let n = 0;
      for (const c of cases) n += steps(image, 'roundTrip', c.args, c.memory, {});
      return n;
    };
    const r0 = lowerToImage(p0.origin, TUNED).image;
    const { p, rejected } = await runSpeed();
    const sp = lowerToImage(p.head, TUNED).image;
    row.lz100 = {
      r0: sum(r0),
      speed: sum(sp),
      reference: sum(ref),
      ...(rejected.length ? { rejected } : {}),
    };
  }
  if (id === 'chess-search') {
    const { zeroState, encodeBoard, fixture, SEARCH_CELLS } = await import(
      '../../../../../../corpus/projects/chess-search/scripts/fixtures.mjs'
    );
    const quiet = fixture('quiet-mate-in-two');
    const call = benchCase(st, 'chessSearch', {
      board: { cells: encodeBoard(quiet.fen, SEARCH_CELLS) },
      state: { record: zeroState },
      depth: 3,
      budget: 1600,
      advanced: 1,
    });
    const r0 = lowerToImage(p0.origin, TUNED).image;
    const { p, rejected } = await runSpeed();
    const sp = lowerToImage(p.head, TUNED).image;
    row.chessSearch = {
      r0: steps(r0, 'chessSearch', call.args, call.memory, {}),
      speed: steps(sp, 'chessSearch', call.args, call.memory, {}),
      reference: steps(ref, 'chessSearch', call.args, call.memory, {}),
      ...(rejected.length ? { rejected } : {}),
    };
  }
  out[id] = row;
  console.log(id, JSON.stringify(row));
}
writeFileSync(process.argv[2] ?? 'benchmarks.json', JSON.stringify(out, null, 1) + '\n');
