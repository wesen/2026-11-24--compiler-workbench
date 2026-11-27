// IRWB-035-D probe 6: the classification must not depend on the meaning check's case count. The measurement runs
// the pipelines at a small count to keep the runtime affordable; this script runs the same projects at a larger
// count and compares every head revision and every pass's edit list.
//
//   node scripts/06-count-independence.mjs [--low 1] [--high 40] [--projects a,b]
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';

await installVendor();
const root = new URL('../../../../../../', import.meta.url).pathname;
const { projectSource, ingestProject, runPipeline } = await import(root + 'dist/typed/project.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const { classifySteps } = await import(root + 'dist/typed/edit-classes.js');

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const LOW = +flag('--low', 1);
const HIGH = +flag('--high', 40);
const ids = flag('--projects', '')
  ? flag('--projects', '').split(',')
  : ['blend', 'bounds-lab', 'bytecode-vm', 'call-chain', 'f32-dsp', 'lz-roundtrip', 'orders', 'regex-nfa'];

let same = 0,
  differ = 0;
for (const id of ids) {
  const p = projectSource(id, projectFiles(id));
  const r0 = ingestProject(p);
  for (const pipeline of ['O2', 'speed']) {
    const roots = p.meta.entries ? { roots: p.meta.entries } : {};
    const run = async count => {
      const r = await runPipeline(r0, pipeline, { manager: new AnalysisManager(), inputs: p.meta.inputs, count, ...roots });
      const steps = classifySteps(r.steps); // no weighting: classification only
      return {
        head: r.artifact.revision,
        edits: r.steps.map(s => s.edits).join(','),
        classes: steps.map(s => `${s.pass}:${s.edits.map(e => e.cls).join('')}`).join(';'),
      };
    };
    const a = await run(LOW),
      b = await run(HIGH);
    const ok = a.head === b.head && a.edits === b.edits && a.classes === b.classes;
    if (ok) same++;
    else differ++;
    console.log(JSON.stringify({ id, pipeline, low: LOW, high: HIGH, same: ok, heads: [a.head.slice(0, 12), b.head.slice(0, 12)] }));
  }
}
console.log(JSON.stringify({ projects: ids.length, low: LOW, high: HIGH, same, differ }));
process.exit(differ ? 1 : 0);
