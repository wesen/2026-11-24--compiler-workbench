// IRWB-039 phase 0: after merging A0-G onto D2, which classes does the edit classifier give D2's new speed passes?
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';
await installVendor();
const R = '../../../../../../dist/typed/';
const { Program } = await import(R + 'program.js');
const { projectSource } = await import(R + 'project.js');
const EC = await import(R + 'edit-classes.js');
const counts = {};
for (const id of ['blend', 'strength', 'value-numbering', 'calls', 'algebra', 'dead-code', 'regex-nfa', 'bytecode-vm']) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  await p.pipeline('speed');
  p.revisions.slice(1).forEach((r, i) => {
    const edits = EC.classifyApplication({ pass: r.pass, before: p.revisions[i].artifact.value, after: r.artifact.value, edits: r.edits });
    for (const e of edits) { const k = `${e.pass} ${e.kind} -> ${e.class}/${e.sub}`; counts[k] = (counts[k] ?? 0) + 1; }
  });
}
for (const [k, n] of Object.entries(counts).sort()) console.log(String(n).padStart(5), k);
