// Compare shapes and dynamic opcode histograms on the historical workload.
import { fixtureCases, load, reference, tuned } from './01-measure.mjs';
const dist = '../../../../../../dist/typed/';
const { Program } = await import(dist + 'program.js');
const { attributeSteps, formatAttribution } = await import(dist + 'attribute.js');
const { codeBytes, imageFromCode, lowerToImage, runImage } = await import(dist + 'backend/index.js');
const { storeOf } = await import(dist + 'ir.js');
const { showStmt } = await import(dist + 'listing.js');

const [id = 'regex-nfa', pipeline = 'speed', mode = 'default', sample = 'first'] = process.argv.slice(2);
const ps = load(id);
const p = Program.fromProject(ps);
const result = await p.pipeline(pipeline);
const rejected = result.steps.filter(s => s.rejected);
if (rejected.length) throw new Error(JSON.stringify(rejected.map(s => s.pass)));
const backend = mode === 'tuned' ? tuned : {};
const cases = fixtureCases(id, p);
const ref = reference(ps);
const referenceCost = c => runImage(ref, c.fn, c.args, c.memory, { counts: false }).steps;
const c = sample === 'hottest'
  ? cases.map(c => ({ c, steps: referenceCost(c) })).sort((a, b) => b.steps - a.steps)[0].c
  : cases[0];
console.log(`Attribution call index: ${c.n}`);
const attribution = attributeSteps(p.revisions, c, { backend });
console.log(formatAttribution(attribution));

const st = storeOf(p.head.value);
const hot = new Map(attribution.hotSites.map(site => [site.id, site]));
const ours = lowerToImage(p.head, backend).image;
const decoded = imageFromCode(id, codeBytes(ours.value), ours.value.entries, []);
const histogram = new Map();
for (const [i, img] of [ref, ours].entries()) {
  const sites = new Map();
  for (const { fn, args, memory } of cases) {
    const run = runImage(img, fn, args, memory);
    if (run.trap || run.limit || run.fault || !run.counts) throw new Error('benchmark did not finish');
    for (const m of (img.value ?? img).insns) {
      const n = run.counts[m.offset >>> 2];
      if (!n) continue;
      // Decode both images on the same path so aliases (ret, j, mv) use the same spelling.
      const op = img === ours ? decoded.insns[m.offset >>> 2].op : m.op;
      const delta = histogram.get(op) ?? [0, 0];
      delta[i] += n;
      histogram.set(op, delta);
      if (img !== ours) continue;
      const site = m.covers.find(s => st.has(s) && st.get(s).kind === 'stmt') ?? '(frame/backend)';
      const row = sites.get(site) ?? { instructions: 0, ops: new Map() };
      row.instructions += n;
      const opLabel = m.why?.startsWith('spill ') ? m.why + '/' + op : op;
      row.ops.set(opLabel, (row.ops.get(opLabel) ?? 0) + n);
      sites.set(site, row);
    }
  }
  if (img === ours) {
    console.log('\nDynamic instructions by final statement, over all cases:');
    for (const [id, { instructions, ops }] of [...sites].sort((a, b) => b[1].instructions - a[1].instructions)) {
      console.log(instructions, id, st.has(id) ? showStmt(st, id) : id, JSON.stringify(Object.fromEntries(ops)));
      const history = hot.get(id)?.history ?? [];
      const credited = history.filter(row => row.edited && row.delta < 0);
      if (!credited.length) console.log('  no direct reduction on attribution call');
      for (const row of history) console.log(' ', row.rev, row.pass, row.delta, row.decision);
    }
  }
}
console.log('\nDynamic opcode counts (reference, workbench, difference):');
for (const [op, [ref, wb]] of [...histogram].sort((a, b) => Math.abs(b[1][1] - b[1][0]) - Math.abs(a[1][1] - a[1][0])))
  console.log(op, ref, wb, wb - ref);
