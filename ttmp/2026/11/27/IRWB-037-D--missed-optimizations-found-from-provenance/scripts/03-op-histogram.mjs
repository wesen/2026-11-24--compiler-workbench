// Dynamic instruction histogram: executed RV32 instructions per opcode, for our image and the reference compiler's,
// on the same call. The difference per op is the gap, before any change.
// usage: node 03-op-histogram.mjs <project> <pipeline> <fn> [--input JSON]
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor({ reference: true });
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { benchCase } = await import(D + 'typed/evaluate.js');
const { imageFromCode, lowerToImage, runImage } = await import(D + 'typed/backend/index.js');

const argv = process.argv.slice(2);
const option = n => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const [id, pipeline, fn] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--input');
const files = projectAllFiles(id), project = projectSource(id, files);
const p = Program.fromProject(project);
const call = benchCase(storeOf(p.origin.value), fn, JSON.parse(option('--input') ?? '{}'));
if (pipeline !== 'r0') await p.pipeline(pipeline);
const ours = lowerToImage(p.head).image;
const { image, entries, signatures } = globalThis.typedRv32.compile(project.source, [], undefined);
const ref = imageFromCode(id, image, entries, signatures);

const hist = img => {
  const r = runImage(img, fn, call.args, call.memory, { counts: true, limit: 2e5 });
  if (r.trap || r.limit || r.fault) throw new Error(`${fn}: trap/limit/fault`);
  const by = new Map();
  const insns = (img.value ?? img).insns; // an artifact for our image, a plain image from the reference
  for (const m of insns) {
    const n = r.counts[m.offset >>> 2];
    if (!n) continue;
    by.set(m.op, (by.get(m.op) ?? 0) + n);
  }
  return { by, steps: r.steps };
};
const a = hist(ours), b = hist(ref);
const ops = [...new Set([...a.by.keys(), ...b.by.keys()])]
  .map(op => ({ op, ours: a.by.get(op) ?? 0, ref: b.by.get(op) ?? 0 }))
  .map(x => ({ ...x, delta: x.ours - x.ref }))
  .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || (x.op < y.op ? -1 : 1));
console.log(`${id} ${pipeline} ${fn}: ours ${a.steps}, reference ${b.steps}, gap ${a.steps - b.steps}\n`);
console.log('   gap   ours    ref  op');
for (const x of ops) console.log(`${String(x.delta).padStart(6)} ${String(x.ours).padStart(6)} ${String(x.ref).padStart(6)}  ${x.op}`);
