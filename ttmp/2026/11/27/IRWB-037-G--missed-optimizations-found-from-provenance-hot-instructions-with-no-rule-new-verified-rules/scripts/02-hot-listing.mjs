// A first look (before the tool): the head revision of a benchmark after a pipeline, block by block, each statement
// with the instructions that cover it and how often each ran. usage: node 02-hot-listing.mjs regex|lz|chess [fn]
//   [--pipeline speed] [--tuned] [--min 1]
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor({ reference: true });
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { showStmt } = await import(D + 'typed/listing.js');
const { lowerToImage, runImage } = await import(D + 'typed/backend/index.js');
const { BENCH } = await import('./01a-bench-cases.mjs');

const argv = process.argv.slice(2);
const opt = n => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const [name, onlyFn] = argv.filter((a, i) => !a.startsWith('--') && !['--pipeline', '--min'].includes(argv[i - 1]));
const b = BENCH[name];
const ps = projectSource(b.id, projectFiles(b.id));
const p = Program.fromProject(ps);
const cases = b.cases(storeOf(p.origin.value), ps);
await p.pipeline(opt('--pipeline') ?? 'speed', { count: 5 });
const st = storeOf(p.head.value);
const { image } = lowerToImage(p.head, argv.includes('--tuned') ? { chains: true, coalesce: true, homes: true } : {});
const counts = new Float64Array(image.value.insns.length + 8);
const index = new Map(image.value.insns.map((m, i) => [m.offset >>> 2, i]));
for (const c of cases) {
  const r = runImage(image, c.fn, c.args, c.memory, { limit: b.limit ?? 2e5 });
  r.counts.forEach((n, w) => n && index.has(w) && (counts[index.get(w)] += n));
}
const min = +(opt('--min') ?? 1);
let total = 0;
const bySite = new Map();
image.value.insns.forEach((m, i) => {
  total += counts[i];
  const stmt = m.covers.find(c => st.has(c) && st.get(c).kind === 'stmt') ?? `${m.fn}:${m.covers.length ? 'frame' : 'backend'}`;
  if (!bySite.has(stmt)) bySite.set(stmt, []);
  bySite.get(stmt).push([m, counts[i]]);
});
console.log(`${name}: ${total} instructions over ${cases.length} case(s)`);
for (const f of st.fns.values()) {
  if (onlyFn && f.name !== onlyFn) continue;
  const fnTotal = image.value.insns.reduce((n, m, i) => n + (m.fn === f.name ? counts[i] : 0), 0);
  if (!fnTotal) continue;
  console.log(`\n== ${f.name}: ${fnTotal}`);
  for (const key of [`${f.name}:frame`, `${f.name}:backend`]) {
    const n = (bySite.get(key) ?? []).reduce((s, [, c]) => s + c, 0);
    if (n) console.log(`   ${key} ${n}`);
  }
  for (const blk of f.blocks) {
    const n = blk.stmts.reduce((s, sid) => s + (bySite.get(sid) ?? []).reduce((t, [, c]) => t + c, 0), 0);
    if (n < min) continue;
    console.log(` ${blk.id}  [${n}]`);
    for (const sid of blk.stmts) {
      const ins = bySite.get(sid) ?? [];
      const sn = ins.reduce((t, [, c]) => t + c, 0);
      const o = st.get(sid).origin?.[0];
      console.log(`   ${String(sn).padStart(7)}  ${showStmt(st, sid)}    {${o ? `${o.via}@r${o.rev}` : ''}}`);
      for (const [m, c] of ins) console.log(`            ${String(c).padStart(7)}  ${m.sym}${m.why ? `   ; ${m.why}` : ''}`);
    }
  }
}
