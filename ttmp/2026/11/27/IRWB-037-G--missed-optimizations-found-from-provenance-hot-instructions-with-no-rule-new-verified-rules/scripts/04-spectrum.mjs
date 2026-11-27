// Gap-guided discovery without a source map: the execution-count spectrum. The reference image has no positions,
// but both images run the same loops the same number of times, so instructions are joined by how often they ran:
// for each count n, (static instructions that ran n times) in ours and in the reference. A count class where we
// have more instructions is a loop body where the reference is shorter per iteration.
// usage: node 04-spectrum.mjs regex|lz|chess [--pipeline speed] [--tuned] [--show N] [--top 12]
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor({ reference: true });
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { lowerToImage, runImage, imageFromCode } = await import(D + 'typed/backend/index.js');
const { BENCH } = await import('./01a-bench-cases.mjs');

const argv = process.argv.slice(2);
const opt = n => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const name = argv[0];
const b = BENCH[name];
const ps = projectSource(b.id, projectFiles(b.id));
const p = Program.fromProject(ps);
const cases = b.cases(storeOf(p.origin.value), ps).slice(0, +(opt('--cases') ?? 1));
await p.pipeline(opt('--pipeline') ?? 'speed', { count: 5 });
const ours = lowerToImage(p.head, argv.includes('--tuned') ? { chains: true, coalesce: true, homes: true } : {}).image;
const r = globalThis.typedRv32.compile(ps.source, [], undefined);
const ref = imageFromCode(b.id, r.image, r.entries, r.signatures);

function profile(image) {
  const counts = new Map();
  for (const c of cases) {
    const run = runImage(image, c.fn, c.args, c.memory, { limit: b.limit ?? 2e5 });
    run.counts.forEach((n, w) => n && counts.set(w, (counts.get(w) ?? 0) + n));
  }
  const classes = new Map();
  for (const m of (image.value ?? image).insns) {
    const n = counts.get(m.offset >>> 2);
    if (!n) continue;
    if (!classes.has(n)) classes.set(n, []);
    classes.get(n).push(m);
  }
  return classes;
}
const A = profile(ours), B = profile(ref);
const rows = [...new Set([...A.keys(), ...B.keys()])].map(n => {
  const a = A.get(n)?.length ?? 0, z = B.get(n)?.length ?? 0;
  return { n, ours: a, ref: z, gap: (a - z) * n };
});
const sum = k => rows.reduce((s, x) => s + x[k] * x.n, 0);
console.log(`${name}: ours ${sum('ours')}, reference ${sum('ref')}, gap ${sum('ours') - sum('ref')}`);
console.log('   count  ours  ref   gap (instructions)');
rows.sort((x, y) => y.gap - x.gap);
const top = +(opt('--top') ?? 12);
for (const x of [...rows.slice(0, top), ...rows.slice(-top)])
  console.log(`${String(x.n).padStart(8)} ${String(x.ours).padStart(5)} ${String(x.ref).padStart(4)} ${String(x.gap).padStart(8)}`);
const show = opt('--show');
if (show) {
  const st = storeOf(p.head.value);
  for (const [label, C] of [['ours', A], ['reference', B]]) {
    console.log(`\n-- ${label}, the instructions that ran ${show} times`);
    for (const m of C.get(+show) ?? [])
      console.log(`  ${m.offset.toString(16).padStart(5)}  ${(m.sym ?? m.text).padEnd(28)} ${m.covers?.filter(c => c.startsWith('s:')).join(' ') ?? ''}${m.why ? ' ; ' + m.why : ''}`);
  }
}
