// The IR listing of one function at the head of a pipeline, with each statement's executed count for one call
// (from the emulator's per-instruction counters), so hot regions can be read with their shapes.
// usage: node 04-listing.mjs <project> <pipeline> <fn> [--input JSON] [--backend JSON] [--rev N]
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { benchCase } = await import(D + 'typed/evaluate.js');
const { lowerToImage, runImage } = await import(D + 'typed/backend/index.js');
const { listing } = await import(D + 'typed/listing.js');

const argv = process.argv.slice(2);
const option = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const [id, pipeline, fn] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--input' && argv[i - 1] !== '--backend');
const ps = projectSource(id, projectAllFiles(id));
const p = Program.fromProject(ps);
const fixed = Object.fromEntries(
  Object.entries(ps.meta.inputs?.[fn] ?? {}).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && !v.oneOf),
);
const call = benchCase(storeOf(p.origin.value), fn, { ...fixed, ...JSON.parse(option('--input') ?? '{}') });
if (pipeline !== 'r0') await p.pipeline(pipeline, { count: 5 });
const rev = option('--rev');
const art = rev !== undefined ? p.at(Number(rev)) : p.head;
const st = storeOf(art.value);
const backend = JSON.parse(option('--backend') ?? '{}');
const { image } = lowerToImage(art, backend);
const r = runImage(image, fn, call.args, call.memory, { limit: 3e7 });
if (r.limit || r.trap) throw new Error('did not finish');
const bySite = new Map();
for (const m of image.value.insns) {
  const n = r.counts[m.offset >>> 2];
  if (!n) continue;
  const site = m.covers.find(c => st.has(c) && st.get(c).kind === 'stmt');
  if (site) bySite.set(site, (bySite.get(site) ?? 0) + n);
}
console.log(`${fn}: ${r.steps} instructions at r${p.rev}`);
// annotate the listing with counts
const text = listing(st, fn);
const out = [];
for (const line of text.split('\n')) {
  const m = /^(s:[A-Za-z0-9_.]+)/.exec(line.trim());
  const n = m ? bySite.get(m[1]) : undefined;
  out.push(n ? `${String(n).padStart(7)}  ${line}` : line);
}
console.log(out.join('\n'));
