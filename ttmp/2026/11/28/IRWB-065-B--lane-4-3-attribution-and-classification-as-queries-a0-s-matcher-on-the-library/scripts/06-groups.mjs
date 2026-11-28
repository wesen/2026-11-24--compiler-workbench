// Where the correspondence's components disagree with IRWB-034-G's `groupOf`: for one program and pipeline, the
// groups of each link that hold more than one entity on a side, with the entries that formed them.
// usage: node 06-groups.mjs [project] [pipeline] [fn]
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';

await installVendor();
const ROOT = new URL('../../../../../../', import.meta.url).href;
const { Program } = await import(ROOT + 'dist/typed/program.js');
const { projectSource } = await import(ROOT + 'dist/typed/project.js');
const { storeOf } = await import(ROOT + 'dist/typed/ir.js');
const { benchCase } = await import(ROOT + 'dist/typed/evaluate.js');
const { lowerToImage, runImage } = await import(ROOT + 'dist/typed/backend/index.js');
const { creditChain } = await import(ROOT + 'dist/framework/ir/attribution.js');

const [id = 'bytecode-vm', pipeline = 'speed', fn = 'runVm'] = process.argv.slice(2);
const project = projectSource(id, projectAllFiles(id));
const p = Program.fromProject(project);
const fixed = Object.fromEntries(
  Object.entries(project.meta.inputs?.[fn] ?? {}).filter(
    ([, v]) => v && typeof v === 'object' && !Array.isArray(v) && !v.oneOf,
  ),
);
const call = benchCase(storeOf(p.origin.value), fn, { ...fixed, entry: 0, n: 12, seed: 8 });
await p.pipeline(pipeline);

const isStmt = (st, x) => typeof x === 'string' && st.has(x) && st.get(x).kind === 'stmt';
const weightsOf = r => {
  const st = storeOf(r.artifact.value);
  const { image, correspondence } = lowerToImage(r.artifact, { coalesce: true });
  const from = new Map();
  for (const e of correspondence.entries) for (const to of e.to) from.set(to, [...(from.get(to) ?? []), ...e.from]);
  const run = runImage(image, call.fn, call.args, call.memory);
  const w = new Map();
  for (const m of image.value.insns) {
    const n = run.counts[m.offset >>> 2];
    if (!n) continue;
    const sources = from.get(m.id) ?? [];
    const site = sources.find(c => isStmt(st, c)) ?? (sources.length ? 'frame' : 'backend');
    w.set(site, (w.get(site) ?? 0) + n);
  }
  return w;
};
const w = p.revisions.map(weightsOf);
const links = p.revisions.slice(1).map(r => ({
  label: r.pass,
  correspondence: r.correspondence,
  derivation: r.derivation,
}));
const credits = creditChain(links, i => w[i]);
for (const c of credits) {
  if (c.before.length < 2 && c.after.length < 2) continue;
  if ((c.beforeWeight === 0 && c.afterWeight === 0) || c.before.length < 2) continue;
  const r = p.revisions[c.link + 1];
  console.log(`\nr${r.rev} ${r.pass} delta ${c.delta}: before ${c.before.join(' ')} | after ${c.after.join(' ')}`);
  const ids = new Set([...c.before, ...c.after]);
  for (const e of r.correspondence.entries)
    if (e.from.some(x => ids.has(x)) || e.to.some(x => ids.has(x)))
      console.log(`   ${e.relation.padEnd(12)} ${e.from.join(',') || '(none)'} -> ${e.to.join(',') || '(none)'}`);
}
