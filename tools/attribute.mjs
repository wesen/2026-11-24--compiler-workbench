// Credit the change in executed RV32 instructions along a pipeline to the passes' decisions, for one call.
// node tools/attribute.mjs <project> <pipeline> <fn> [--input '{"n":12}'] [--backend '{"coalesce":true}'] [--rows] [--json]
// --coalesce is short for --backend '{"coalesce":true}'.
// --hot N: the N hottest statements of the last revision with their machine instructions and provenance (the edits
// of the chain that name them or an ancestor, and the ancestor's count at r0) instead of the step table.
// --reference: also run the reference compiler's image on the same call and list instructions per function.
// Parameters not in --input take the project's own input when that is a fixed value (a buffer's cells), else 0.
import { installVendor } from './node-vendor.mjs';
import { projectAllFiles } from './corpus.mjs';

const argv0 = process.argv.slice(2);
await installVendor({ reference: argv0.includes('--reference') });
const { Program } = await import('../dist/typed/program.js');
const { projectSource } = await import('../dist/typed/project.js');
const { storeOf } = await import('../dist/typed/ir.js');
const { benchCase } = await import('../dist/typed/evaluate.js');
const { attributeSteps, formatAttribution, hotSites } = await import('../dist/typed/attribute.js');
const B = await import('../dist/typed/backend/index.js');

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const option = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const [id, pipeline, fn] = argv.filter(
  (a, i) => !a.startsWith('--') && !['--input', '--backend', '--hot'].includes(argv[i - 1]),
);
if (!id || !pipeline || !fn) {
  console.error(
    'usage: node tools/attribute.mjs <project> <pipeline> <fn> [--input JSON] [--backend JSON] [--coalesce] [--rows] [--json] [--hot N] [--reference]',
  );
  process.exit(2);
}
const project = projectSource(id, projectAllFiles(id));
const p = Program.fromProject(project);
const fixed = Object.fromEntries(
  Object.entries(project.meta.inputs?.[fn] ?? {}).filter(
    ([, v]) => v && typeof v === 'object' && !Array.isArray(v) && !v.oneOf,
  ),
);
const call = benchCase(storeOf(p.origin.value), fn, { ...fixed, ...JSON.parse(option('--input') ?? '{}') });
// a pipeline by name, or passes separated by commas
const run = await p.pipeline(pipeline.includes(',') ? pipeline.split(',') : pipeline);
const rejected = run.steps.filter(s => s.rejected).map(s => s.pass);
if (rejected.length) console.error(`rejected: ${rejected.join(', ')}`);
const backend = {
  ...(flag('--coalesce') ? { coalesce: true } : {}),
  ...JSON.parse(option('--backend') ?? '{}'),
};
if (flag('--reference')) {
  // instructions per function: ours (the head, these options) and the reference compiler's image
  const perFn = img => {
    const r = B.runImage(img, call.fn, call.args, call.memory, { limit: 1e8 });
    const by = {};
    for (const m of (img.value ?? img).insns) if (r.counts[m.offset >>> 2]) by[m.fn] = (by[m.fn] ?? 0) + r.counts[m.offset >>> 2];
    return { total: r.steps, by, r };
  };
  const ref = globalThis.typedRv32.compile(project.source, [], undefined);
  const refImage = B.imageFromCode(id, ref.image, ref.entries, ref.signatures);
  const ours = perFn(B.lowerToImage(p.head, backend).image),
    theirs = perFn(refImage);
  console.log(`instructions: ours ${ours.total}, reference ${theirs.total}`);
  for (const f of new Set([...Object.keys(ours.by), ...Object.keys(theirs.by)]))
    console.log(`  ${f.padEnd(20)} ${String(ours.by[f] ?? 0).padStart(10)} ${String(theirs.by[f] ?? 0).padStart(10)}`);
  const top = +(option('--hot') ?? 30);
  console.log('\nreference, hottest instructions:');
  for (const m of [...refImage.insns]
    .map(m => ({ m, n: theirs.r.counts[m.offset >>> 2] }))
    .filter(x => x.n)
    .sort((x, y) => y.n - x.n)
    .slice(0, top))
    console.log(`  ${String(m.n).padStart(8)}  ${m.m.fn}+${m.m.offset - refImage.entries[m.m.fn]}  ${m.m.text}`);
  console.log('');
}
if (option('--hot')) {
  const h = hotSites(p.revisions, call, { backend });
  console.log(`${call.fn}: ${h.total} instructions at r${p.rev}; hottest statements:`);
  for (const s of h.sites.slice(0, +option('--hot'))) {
    console.log(
      `\n${String(s.count).padStart(8)}  ${s.id}  ${s.text}` +
        (s.ancestor && s.ancestor !== s.id ? `  (from ${s.ancestor}, ${s.first} at r0)` : s.ancestor ? `  (${s.first} at r0)` : '  (new)'),
    );
    for (const d of s.decisions) console.log(`          | ${d}`);
    for (const m of s.insns) console.log(`          ${String(m.count).padStart(6)}  ${m.text}`);
  }
  process.exit(0);
}
const a = attributeSteps(p.revisions, call, { backend });
if (flag('--json')) console.log(JSON.stringify(a, null, 1));
else {
  console.log(formatAttribution(a));
  if (flag('--rows'))
    for (const r of a.rows.filter(r => r.delta))
      console.log(
        `\nr${r.rev} ${String(r.delta > 0 ? '+' + r.delta : r.delta).padStart(6)}  ${r.decision}  [${r.because.join(', ')}]\n` +
          r.sites.map(s => `          ${s.id.padEnd(14)} ${s.text}`).join('\n'),
      );
}
