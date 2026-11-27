/** 07 — inspect the positive licm decisions and their entries, to pin the test's expectations. */
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const { attributeSteps } = await import('../../../../../../dist/typed/attribute.js');
const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const p = Program.fromProject(project);
await p.pipeline('speed');
const st0 = storeOf(p.origin.value);
const c = benchCase(st0, 'runVm', { code: project.meta.inputs.runVm.code, entry: 0, n: 12, seed: 8 });
const licm = attributeSteps(p, { fn: 'runVm', args: c.args, memory: c.memory, backend: { coalesce: true } }).find(t => t.pass === 'licm');
for (const d of licm.decisions.filter(d => d.credit > 0))
  console.log(d.edit, d.kind, d.credit, JSON.stringify(d.entries.map(e => ({ rel: e.relation, note: e.note, from: e.from, to: e.to, credit: e.credit }))));
