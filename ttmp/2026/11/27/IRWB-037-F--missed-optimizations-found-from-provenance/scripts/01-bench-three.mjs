// The three benchmarks of the brief, as their own tickets measured them (IRWB-015, IRWB-014, IRWB-017):
//   regex-nfa     regexMatch('[a-c]*[b-d]*a*d', 'abccabbd'), default backend options (also tuned)
//   lz-roundtrip  roundTrip over 100 seed-7 generated cases, tuned options (chains, coalesce, homes)
//   chess-search  quiet-mate-in-two at depth 3, budget 1,600, tuned options (corpus fixtures.mjs measure)
// Images: r0, checked `speed`, reference compiler.
// usage: node 01-bench-three.mjs [out.json] [--only regex,lz,chess] [--passes a,b,c (instead of speed)]
import { writeFileSync } from 'node:fs';
const root = new URL('../../../../../../', import.meta.url);
const { installVendor } = await import(new URL('tools/node-vendor.mjs', root));
const { projectFiles } = await import(new URL('tools/corpus.mjs', root));
await installVendor({ reference: true });
const D = new URL('dist/', root);
const { Program } = await import(new URL('typed/program.js', D));
const { projectSource } = await import(new URL('typed/project.js', D));
const { storeOf } = await import(new URL('typed/ir.js', D));
const { benchCase, casesFrom } = await import(new URL('typed/evaluate.js', D));
const B = await import(new URL('typed/backend/index.js', D));
const TUNED = { chains: true, coalesce: true, homes: true };
const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : ['regex', 'lz', 'chess'];
const passes = argv.includes('--passes') ? argv[argv.indexOf('--passes') + 1].split(',') : 'speed';
const out = argv.find((a, i) => !a.startsWith('--') && !['--only', '--passes'].includes(argv[i - 1]));

async function images(id, pipeline = passes) {
  const ps = projectSource(id, projectFiles(id));
  const p = Program.fromProject(ps);
  const r0 = p.origin;
  const run = await p.pipeline(pipeline);
  const rejected = run.steps.filter(s => s.rejected).map(s => s.pass);
  const ref = globalThis.typedRv32.compile(ps.source, [], undefined);
  return {
    p, ps, rejected,
    r0: B.lowerToImage(r0).image,
    speed: B.lowerToImage(p.head).image,
    speedTuned: B.lowerToImage(p.head, TUNED).image,
    reference: B.imageFromCode(id, ref.image, ref.entries, ref.signatures),
  };
}
const steps = (img, k, limit = 2e7) => {
  const r = B.runImage(img, k.fn, k.args, k.memory, { limit, counts: false });
  if (r.limit || r.trap) throw new Error(`run did not finish: ${JSON.stringify({ limit: r.limit, trap: r.trap })}`);
  return r.steps;
};
const result = {};
if (only.includes('regex')) {
  const im = await images('regex-nfa');
  const k = benchCase(storeOf(im.p.origin.value), 'regexMatch', {
    pattern: { string: '[a-c]*[b-d]*a*d' }, text: { string: 'abccabbd' },
  });
  result.regex = { rejected: im.rejected, r0: steps(im.r0, k), speed: steps(im.speed, k), speedTuned: steps(im.speedTuned, k), reference: steps(im.reference, k) };
}
if (only.includes('lz')) {
  const id = 'lz-roundtrip';
  const im = await images(id);
  const cases = casesFrom(storeOf(im.p.origin.value), 'roundTrip', { count: 100, seed: 7, inputs: im.ps.meta.inputs.roundTrip });
  const sum = img => cases.reduce((n, k) => n + steps(img, { ...k, fn: 'roundTrip' }, 2e5), 0);
  result.lz = { rejected: im.rejected, r0: sum(im.r0), speed: sum(im.speed), speedTuned: sum(im.speedTuned), reference: sum(im.reference) };
}
if (only.includes('chess')) {
  const F = await import(new URL('corpus/projects/chess-search/scripts/fixtures.mjs', root));
  const ctx = await F.loadProject();
  const imgs = await F.buildImages({ ...ctx, project: { ...ctx.project, meta: { ...ctx.project.meta, pipeline: passes } } });
  const r = F.checkSearchFixture(ctx, imgs, F.positions.find(x => x.name === 'quiet-mate-in-two'), 3);
  result.chess = { move: r.move, ...r.instructions };
}
console.log(JSON.stringify(result, null, 1));
if (out) writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
