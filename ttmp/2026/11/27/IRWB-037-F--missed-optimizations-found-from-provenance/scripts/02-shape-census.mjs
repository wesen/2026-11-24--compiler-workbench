// Shape census of executed code (IRWB-037-F, method step 1): for every corpus project after a pipeline, run the
// seeded cases `measure` uses (10 per function, seed 7) with per-instruction counts, and weight every value tree
// node by how often its statement runs (the largest count among the statement's instructions). Each node's shape is
// its operator over its operands' operators, with constants shown as #c (or their value when it is 0, 1 or -1),
// other leaves as `x`. The table sums the weights per shape over the corpus and lists, per shape, the rule of the
// simplify and fold tables that matches it (none, normally: the pipeline already ran them).
// usage: node 02-shape-census.mjs <pipeline> [--backend JSON] [--top N] [--json out.json] [id...]
import { writeFileSync } from 'node:fs';
const root = new URL('../../../../../../', import.meta.url);
const { installVendor } = await import(new URL('tools/node-vendor.mjs', root));
const { projectIds, projectFiles } = await import(new URL('tools/corpus.mjs', root));
await installVendor();
const D = new URL('dist/', root);
const { Program } = await import(new URL('typed/program.js', D));
const { projectSource } = await import(new URL('typed/project.js', D));
const { storeOf } = await import(new URL('typed/ir.js', D));
const { casesFrom } = await import(new URL('typed/evaluate.js', D));
const B = await import(new URL('typed/backend/index.js', D));
const argv = process.argv.slice(2);
const opt = n => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const [pipeline = 'speed', ...only] = argv.filter((a, i) => !a.startsWith('--') && !['--backend', '--top', '--json'].includes(argv[i - 1]));
const backend = JSON.parse(opt('--backend') ?? '{}');
const top = +(opt('--top') ?? 40);

const leaf = (st, id) => {
  const v = st.get(id);
  if (v.op === 'const') return [0, 1, -1].includes(v.imm) ? String(v.imm) : '#c';
  return v.op === 'get' ? 'x' : v.op;
};
const shapeOf = (st, v) => `${v.op}(${v.args.map(a => leaf(st, a)).join(', ')})`;
const census = new Map();
for (const id of only.length ? only : projectIds()) {
  const ps = projectSource(id, projectFiles(id));
  const p = Program.fromProject(ps);
  if (p.status !== 'ok') continue;
  if (pipeline !== 'r0') await p.pipeline(pipeline.includes(',') ? pipeline.split(',') : pipeline, { count: 5 });
  const st = storeOf(p.head.value);
  const { image } = B.lowerToImage(p.head, backend);
  const counts = new Float64Array(image.value.bytes / 4);
  for (const fn of p.head.value.fnOrder)
    for (const c of casesFrom(st, fn, { count: 10, seed: 7, inputs: p.inputs[fn] ?? {} })) {
      const r = B.runImage(image, fn, c.args, c.memory, { limit: 2e5 });
      if (r.limit || !r.counts) continue;
      r.counts.forEach((n, i) => (counts[i] += n));
    }
  // statement executions and instructions
  const runs = new Map(), insns = new Map();
  for (const m of image.value.insns) {
    const n = counts[m.offset >>> 2];
    const s = m.covers.find(x => st.has(x) && st.get(x).kind === 'stmt');
    if (!s) continue;
    runs.set(s, Math.max(runs.get(s) ?? 0, n));
    insns.set(s, (insns.get(s) ?? 0) + n);
  }
  for (const [sid, n] of runs) {
    if (!n) continue;
    const s = st.get(sid);
    const walk = vid => {
      const v = st.get(vid);
      if (!v || v.kind !== 'value') return;
      if (v.op !== 'const' && v.op !== 'get') {
        const k = shapeOf(st, v);
        let e = census.get(k);
        if (!e) census.set(k, (e = { weight: 0, nodes: 0, projects: new Map() }));
        e.weight += n;
        e.nodes++;
        e.projects.set(id, (e.projects.get(id) ?? 0) + n);
      }
      v.args.forEach(walk);
    };
    for (const f of ['value', 'cond', 'addr']) if (s[f]) walk(s[f]);
  }
  console.error(id);
}
const rows = [...census].map(([shape, e]) => ({ shape, weight: e.weight, nodes: e.nodes, projects: [...e.projects].sort((a, b) => b[1] - a[1]).slice(0, 4) }));
rows.sort((a, b) => b.weight - a.weight);
for (const r of rows.slice(0, top))
  console.log(`${String(r.weight).padStart(10)} ${String(r.nodes).padStart(5)}  ${r.shape.padEnd(28)} ${r.projects.map(([p, n]) => `${p} ${n}`).join(', ')}`);
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(rows, null, 1) + '\n');
