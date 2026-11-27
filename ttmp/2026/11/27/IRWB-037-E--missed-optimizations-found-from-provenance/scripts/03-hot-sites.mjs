// Hot executed instructions at the head of a pipeline, per statement site, with each site's provenance: the pass
// decisions (edits across revisions) that touched it, and the text of the statement and its value trees. This is
// the "close the loop" probe: hot sites whose provenance names no rule or pass improving them are the gap.
// usage: node 03-hot-sites.mjs <project> <pipeline> <fn> [--input JSON] [--backend JSON] [--top 20] [--calls]
import { writeFileSync } from 'node:fs';
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { benchCase, show } = await import(D + 'typed/evaluate.js');
const { lowerToImage, runImage } = await import(D + 'typed/backend/index.js');
const { showStmt } = await import(D + 'typed/listing.js');

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const option = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const [id, pipeline, fn] = argv.filter(
  (a, i) => !a.startsWith('--') && !['--input', '--backend', '--top'].includes(argv[i - 1]),
);
const top = Number(option('--top') ?? 20);
const ps = projectSource(id, projectAllFiles(id));
const p = Program.fromProject(ps);
const fixed = Object.fromEntries(
  Object.entries(ps.meta.inputs?.[fn] ?? {}).filter(
    ([, v]) => v && typeof v === 'object' && !Array.isArray(v) && !v.oneOf,
  ),
);
const call = benchCase(storeOf(p.origin.value), fn, { ...fixed, ...JSON.parse(option('--input') ?? '{}') });
const run = await p.pipeline(pipeline, { count: 5 });
const rejected = run.steps.filter(s => s.rejected).map(s => s.pass);
if (rejected.length) console.error(`rejected: ${rejected.join(', ')}`);
const backend = JSON.parse(option('--backend') ?? '{}');
const st = storeOf(p.head.value);
const { image } = lowerToImage(p.head, backend);
const r = runImage(image, fn, call.args, call.memory, { limit: 3e7 });
if (r.limit || r.trap || r.fault) throw new Error(`did not finish: limit=${r.limit} trap=${r.trap}`);
console.log(`${fn}: ${r.steps} instructions at the head of ${pipeline}`);
const bySite = new Map();
for (const m of image.value.insns) {
  const n = r.counts[m.offset >>> 2];
  if (!n) continue;
  const site = m.covers.find(c => st.has(c) && st.get(c).kind === 'stmt') ?? (m.covers.length ? 'frame' : 'backend');
  bySite.set(site, (bySite.get(site) ?? 0) + n);
}
const hot = [...bySite].sort((a, b) => b[1] - a[1]).slice(0, top);
// provenance: every edit of every revision that names the site, and the pass of the revision that introduced it
const editsOf = new Map();
for (const rev of p.revisions)
  for (const e of rev.edits)
    for (const x of [e.stmt, ...(e.kind === 'replaceStmt' ? [e.from, e.to] : [])])
      if (x) {
        const list = editsOf.get(x) ?? [];
        list.push({ rev: rev.rev, pass: rev.pass, kind: e.kind, note: e.note ?? null });
        editsOf.set(x, list);
      }
for (const rev of p.revisions) void rev;
for (const [site, n] of hot) {
  if (site === 'frame' || site === 'backend') {
    console.log(`\n${String(n).padStart(8)}  ${site}`);
    continue;
  }
  const s = st.get(site);
  const edits = editsOf.get(site) ?? [];
  const origin = s.origin?.[0];
  const introduced = origin?.from && origin.from !== 'source' ? `${origin.via} from ${origin.from}` : 'front end';
  console.log(
    `\n${String(n).padStart(8)}  ${site}  ${showStmt(st, site)}`,
  );
  console.log(`          introduced: ${introduced}`);
  if (origin?.note) console.log(`          origin note: ${origin.note}`);
  for (const e of edits) console.log(`          edit r${e.rev} ${e.pass}: ${e.kind}${e.note ? ` (${e.note})` : ''}`);
}
writeFileSync(
  `hot-${id}.json`,
  JSON.stringify({ fn, steps: r.steps, sites: [...bySite].sort((a, b) => b[1] - a[1]) }, null, 1),
);
