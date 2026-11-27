// Hot sites: executed instructions per statement at one revision of a project, largest first, with the statements
// that no pass has changed (the statement is the same id at r0 and no edit along the chain names it).
// usage: node 02-hot-sites.mjs <project> <pipeline> <fn> [--input JSON] [--limit N] [--all]
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { benchCase } = await import(D + 'typed/evaluate.js');
const { showStmt } = await import(D + 'typed/listing.js');
const { lowerToImage, runImage } = await import(D + 'typed/backend/index.js');

const argv = process.argv.slice(2);
const option = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const [id, pipeline, fn] = argv.filter(
  (a, i) => !a.startsWith('--') && argv[i - 1] !== '--input' && argv[i - 1] !== '--limit',
);
const project = projectSource(id, projectAllFiles(id));
const p = Program.fromProject(project);
const fixed = Object.fromEntries(
  Object.entries(project.meta.inputs?.[fn] ?? {}).filter(
    ([, v]) => v && typeof v === 'object' && !Array.isArray(v) && !v.oneOf && !v.string && !v.buffer && !v.cells,
  ),
);
const call = benchCase(storeOf(p.origin.value), fn, { ...fixed, ...JSON.parse(option('--input') ?? '{}') });
if (pipeline !== 'r0') await p.pipeline(pipeline);

// every statement id any pass edited, along the chain
const edited = new Set();
for (const r of p.revisions.slice(1))
  for (const e of r.edits) for (const x of [e.stmt, e.from, e.to]) if (x) edited.add(x);

const art = p.head, st = storeOf(art.value);
const { image } = lowerToImage(art);
const run = runImage(image, fn, call.args, call.memory, { counts: true, limit: 2e5 });
const rows = [];
for (const m of image.value.insns) {
  const n = run.counts[m.offset >>> 2];
  if (!n) continue;
  const stmt = m.covers.find(c => st.has(c) && st.get(c).kind === 'stmt');
  rows.push({ site: stmt ?? (m.covers.length ? 'frame' : 'backend'), n });
}
const by = new Map();
for (const r of rows) by.set(r.site, (by.get(r.site) ?? 0) + r.n);
const r0 = storeOf(p.origin.value);
const text = site => (st.has(site) ? showStmt(st, site) : site);
const shape = site => {
  if (!st.has(site)) return '';
  const s = st.get(site);
  const v = s.expr ? st.get(s.expr) : undefined;
  return v ? v.op : s.kind;
};
const list = [...by].sort((a, b) => b[1] - a[1]);
for (const [site, n] of list.slice(0, Number(option('--limit') ?? 40)))
  console.log(
    `${String(n).padStart(7)}  ${edited.has(site) ? 'EDIT' : r0.has(site) ? '    ' : 'NEW '} ${shape(site).padEnd(10)} ${text(site)}   [${site}]`,
  );
console.log(`total ${run.steps}`);
