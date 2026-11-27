// IRWB-034-F probe 04: the attribution of the bytecode VM's instruction difference under a pipeline (default
// speed), both fixtures at n=12 seed=8, coalesce: true; and, as a cross-check, the per-pass difference from a
// replay of pass prefixes (each pass's image minus the one before).
// node ttmp/.../scripts/04-attribute-vm.mjs [pipeline] [--insns]
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const { projectAllFiles } = await import('../../../../../../tools/corpus.mjs');
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const B = await import('../../../../../../dist/typed/backend/index.js');

const pipeline = process.argv[2] ?? 'speed';
const options = { coalesce: true };
const id = 'bytecode-vm';
const project = projectSource(id, projectAllFiles(id));
const p = Program.fromProject(project);
const code = project.meta.inputs.runVm.code;
const st0 = storeOf(p.origin.value);
const fixtures = [0, 34].map(entry => benchCase(st0, 'runVm', { code, entry, n: 12, seed: 8 }));
await p.pipeline(pipeline);

const a = p.attribute(fixtures, { backend: options });
console.log(`r${a.from.rev} ${a.from.total} -> r${a.to.rev} ${a.to.total}: difference ${a.difference}`);
const sum = a.decisions.reduce((s, d) => s + d.net, 0);
console.log(`sum of nets ${sum}`);
const fmt = d =>
  `${String(d.net).padStart(7)} ${String(d.credit).padStart(7)} ${String(d.debit).padStart(7)} ${String(d.insns.join('/')).padStart(7)}  ${d.key}  {${d.kinds.join(',')}}`;
console.log('\n    net  credit   debit   insns  decision {kinds}');
for (const d of a.decisions) console.log(fmt(d));
console.log('\nper pass');
for (const d of a.passes) console.log(fmt(d));

// cross-check: replay the published chain one revision at a time
console.log('\nreplay: per revision, the image minus the one before (both fixtures)');
const total = art => {
  const { image } = B.lowerToImage(art, options);
  return fixtures.reduce((s, c) => s + B.runImage(image, c.fn, c.args, c.memory).steps, 0);
};
let before = total(p.revisions[0].artifact);
for (const r of p.revisions.slice(1)) {
  const now = total(r.artifact);
  const attributed = a.passes.find(x => x.key === `r${r.rev} ${r.pass}`)?.net ?? 0;
  console.log(`r${r.rev} ${r.pass.padEnd(10)} replay ${String(now - before).padStart(6)}  attribution ${String(attributed).padStart(6)}`);
  before = now;
}
if (process.argv.includes('--insns')) {
  console.log('\nexecuted instructions of the last image');
  for (const i of a.insns)
    console.log(`${String(i.count).padStart(5)} ${i.sym.padEnd(26)} ${i.covers.join(',').padEnd(26)} ${i.decision}`);
}

console.log('\nstep by step (attributeSteps): per revision, its decisions with |net| >= 10, and the sum of the rest');
for (const s of p.attribute(fixtures, { backend: options, steps: true })) {
  const r = p.revisions[s.to.rev];
  console.log(`r${r.rev} ${r.pass}: ${s.from.total} -> ${s.to.total}, difference ${s.difference}`);
  const big = s.decisions.filter(d => Math.abs(d.net) >= 10);
  for (const d of big) console.log('  ' + fmt(d));
  const rest = s.decisions.filter(d => Math.abs(d.net) < 10);
  if (rest.length) console.log(`  ${String(rest.reduce((t, d) => t + d.net, 0)).padStart(7)}  (${rest.length} more decisions)`);
}
