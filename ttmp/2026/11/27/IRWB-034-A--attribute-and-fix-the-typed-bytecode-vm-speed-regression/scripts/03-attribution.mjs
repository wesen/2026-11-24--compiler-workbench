import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { attributeInstructions, lowerToImage, runImage } from '../../../../../../dist/typed/backend/index.js';
import { benchCase } from '../../../../../../dist/typed/evaluate.js';
import { storeOf } from '../../../../../../dist/typed/ir.js';
import { Program } from '../../../../../../dist/typed/program.js';
import { projectSource } from '../../../../../../dist/typed/project.js';

await installVendor();
const project = projectSource('bytecode-vm', projectFiles('bytecode-vm'));
const p = Program.fromProject(project);
const result = await p.pipeline('speed');
if (result.steps.some(s => s.rejected)) throw new Error(JSON.stringify(result.steps));
const input = project.meta.inputs.runVm;
const fold = p.revisions.findIndex(r => r.pass === 'fold');
const licm = p.revisions.findIndex(r => r.pass === 'licm');
const checkpoints = new Set([0, fold, licm - 1, licm, p.rev]);
for (const rev of checkpoints) {
  if (rev < 0) continue;
  const lowered = lowerToImage(p.revisions[rev].artifact, { coalesce: true });
  for (const entry of input.entry.oneOf) {
    const c = benchCase(storeOf(p.origin.value), 'runVm', { code: input.code, entry, n: 12, seed: 8 });
    const run = runImage(lowered.image, c.fn, c.args, c.memory);
    const rows = attributeInstructions(lowered, run, p.revisions.slice(0, rev + 1));
    const latest = {};
    const licmReasons = {};
    const hoists = {};
    const rules = new Set();
    for (const row of rows) {
      const changes = row.lineage.filter(step => step.changed);
      const step = changes[0];
      const label = step ? `r${step.revision} ${step.pass}` : row.covered.length ? 'r0' : 'uncovered';
      latest[label] = (latest[label] ?? 0) + row.count;
      if (changes.some(s => s.pass === 'licm')) {
        const reason = row.instruction.why ?? row.instruction.op;
        licmReasons[reason] = (licmReasons[reason] ?? 0) + row.count;
        if (reason === 'frame array') {
          const hoist = changes.find(s => s.pass === 'licm' && s.origin?.note?.startsWith('hoisted'));
          if (hoist) hoists[hoist.entity] = (hoists[hoist.entity] ?? 0) + row.count;
        }
      }
      for (const s of changes)
        for (const edit of s.edits)
          for (const rule of edit.rules ?? []) rules.add(`${rule.name}@${rule.version}`);
    }
    console.log(JSON.stringify({ entry, rev, steps: run.steps, latest, licmReasons, hoists, rules: [...rules] }));
  }
}
