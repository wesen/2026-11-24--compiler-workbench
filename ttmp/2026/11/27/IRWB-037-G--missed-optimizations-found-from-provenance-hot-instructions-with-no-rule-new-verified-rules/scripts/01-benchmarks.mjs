// The three benchmarks the brief names, as their tickets measured them, on the current compiler:
//  - regex:  regexMatch('[a-c]*[b-d]*a*d', 'abccabbd'), default backend options (IRWB-015)
//  - lz:     roundTrip over 100 seed-7 cases, speed with chains+coalesce+homes (IRWB-014)
//  - chess:  chessSearch on quiet-mate-in-two at depth 3, speed with chains+coalesce+homes (IRWB-017)
// each at r0, after the pipeline (default and tuned options), and on the reference compiler's image.
// usage: node 01-benchmarks.mjs [out.json] [--pipeline speed] [--only regex,lz,chess]
import { writeFileSync } from 'node:fs';
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
const out = argv.find((a, i) => !a.startsWith('--') && !(argv[i - 1] ?? '').startsWith('--'));
const pipeline = opt('--pipeline') ?? 'speed';
const only = (opt('--only') ?? 'regex,lz,chess').split(',');
const TUNED = { chains: true, coalesce: true, homes: true };

const result = {};
for (const name of only) {
  const b = BENCH[name];
  const ps = projectSource(b.id, projectFiles(b.id));
  const p = Program.fromProject(ps);
  const cases = b.cases(storeOf(p.origin.value), ps);
  const total = image => {
    let n = 0;
    for (const c of cases) {
      const r = runImage(image, c.fn, c.args, c.memory, { limit: b.limit ?? 2e5, counts: false });
      if (r.trap || r.limit || r.fault) throw new Error(`${name}: case did not finish`);
      n += r.steps;
    }
    return n;
  };
  const row = { cases: cases.length };
  row.r0 = total(lowerToImage(p.origin).image);
  const run = await p.pipeline(pipeline, { count: 20 });
  row.rejected = run.steps.filter(s => s.rejected).map(s => s.pass);
  row[pipeline] = total(lowerToImage(p.head).image);
  row[pipeline + ' tuned'] = total(lowerToImage(p.head, TUNED).image);
  const ref = globalThis.typedRv32.compile(ps.source, [], undefined);
  row.reference = total(imageFromCode(b.id, ref.image, ref.entries, ref.signatures));
  result[name] = row;
  console.log(name.padEnd(6), JSON.stringify(row));
}
if (out) writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
