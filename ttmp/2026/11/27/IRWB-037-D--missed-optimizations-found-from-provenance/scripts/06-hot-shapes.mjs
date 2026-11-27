// The loop from hot code to candidate rules: for every corpus project at `speed`, list the statements that execute
// the most instructions at the last revision and that no pass's edit record names, with the shape of their value
// tree (operator and the operators below it). A shape that occurs hot and matches no rule of SIMPLIFY_RULES or
// FOLD_RULES is a candidate; the script prints the hottest ones, grouped, with their executed instruction totals.
// usage: node 06-hot-shapes.mjs [--json] [--limit N] [id...]
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { casesFrom } = await import(D + 'typed/evaluate.js');
const { lowerToImage, runImage } = await import(D + 'typed/backend/index.js');
const { toNodePattern } = await import(D + 'typed/rules/form.js');
const { SIMPLIFY_RULES } = await import(D + 'typed/rules/simplify.js');
const { FOLD_RULES } = await import(D + 'typed/rules/fold.js');

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const limit = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : 25;
const only = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--limit');
const LIMIT = 2e5;

/** The shape of a value tree: the operator and its children's operators, constants written out. */
function shape(st, id, depth = 3) {
  if (!id) return '';
  const v = st.get(id);
  if (!v || v.kind !== 'value') return '';
  if (v.op === 'const') return String(v.imm);
  if (v.op === 'get') return 'x';
  if (depth === 0) return v.op;
  return `${v.op}(${v.args.map(a => shape(st, a, depth - 1)).join(', ')})`;
}

const roots = [...SIMPLIFY_RULES.rules, ...FOLD_RULES.rules].map(r => {
  const p = toNodePattern(r);
  return JSON.stringify(p);
});

const hot = new Map();
const perProject = {};
for (const id of only.length ? only : projectIds()) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  await p.pipeline('speed', { count: 5 });
  const art = p.head, st = storeOf(art.value);
  const edited = new Set();
  for (const r of p.revisions.slice(1)) for (const e of r.edits) for (const x of [e.stmt, e.from, e.to]) if (x) edited.add(x);
  const { image } = lowerToImage(art);
  let total = 0;
  const sites = new Map();
  for (const fn of art.value.fnOrder)
    for (const c of casesFrom(st, fn, { count: 10, seed: 7, inputs: p.inputs[fn] ?? {} })) {
      const r = runImage(image, fn, c.args, c.memory, { limit: LIMIT, counts: true });
      if (!r.counts || r.trap || r.limit) continue;
      for (const m of image.value.insns) {
        const n = r.counts[m.offset >>> 2];
        if (!n) continue;
        const site = m.covers.find(x => st.has(x) && st.get(x).kind === 'stmt');
        if (!site) continue;
        sites.set(site, (sites.get(site) ?? 0) + n);
        total += n;
      }
    }
  perProject[id] = { instructions: total, hotSites: [...sites.values()].filter(n => n > 0).length };
  for (const [site, n] of sites) {
    if (edited.has(site)) continue; // a pass improved or rewrote it: not "no rule or pass improving it"
    const s = st.get(site);
    const v = s.value ?? s.cond ?? s.addr;
    const key = `${s.op} ${shape(st, v)}`;
    const row = hot.get(key) ?? { shape: key, instructions: 0, sites: 0, projects: new Set() };
    row.instructions += n;
    row.sites++;
    row.projects.add(id);
    hot.set(key, row);
  }
}
const rows = [...hot.values()]
  .map(r => ({ ...r, projects: [...r.projects].sort() }))
  .sort((a, b) => b.instructions - a.instructions);
if (json) console.log(JSON.stringify({ perProject, rows }, null, 1));
else {
  console.log('instructions   sites  projects                 shape (unchanged by every pass at speed)');
  for (const r of rows.slice(0, limit))
    console.log(
      `${String(r.instructions).padStart(12)} ${String(r.sites).padStart(6)}  ${r.projects.slice(0, 4).join(',').slice(0, 24).padEnd(24)} ${r.shape}`,
    );
  const totalAll = Object.values(perProject).reduce((a, r) => a + r.instructions, 0);
  const hotAll = rows.reduce((a, r) => a + r.instructions, 0);
  console.log(`\n${hotAll} of ${totalAll} executed instructions are charged to statements no pass edited (${((100 * hotAll) / totalAll).toFixed(1)} %)`);
  console.log(`${rows.length} distinct shapes, ${roots.length} rules to match them against`);
}
