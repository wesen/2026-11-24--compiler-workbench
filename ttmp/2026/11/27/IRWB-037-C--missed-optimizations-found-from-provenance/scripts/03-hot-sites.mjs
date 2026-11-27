import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const { showStmt } = await import('../../../../../../dist/typed/listing.js');
const { lowerToImage, runImage } = await import('../../../../../../dist/typed/backend/index.js');
const project = projectSource('regex-nfa', projectAllFiles('regex-nfa'));
const p = Program.fromProject(project);
const call = benchCase(storeOf(p.origin.value), 'regexMatch', {pattern: {string:'[a-c]*[b-d]*a*d'}, text: {string:'abccabbd'}});
await p.pipeline('speed');
const st = storeOf(p.head.value), {image} = lowerToImage(p.head);
const run = runImage(image, 'regexMatch', call.args, call.memory);
const sites = new Map();
for (const ins of image.value.insns) {
  const n = run.counts[ins.offset >>> 2];
  if (!n) continue;
  const id = ins.covers.find(x => st.has(x) && st.get(x).kind === 'stmt') ?? 'frame/backend';
  const row = sites.get(id) ?? {count:0, insns:[]};
  row.count += n; row.insns.push(`${n} ${ins.op}`); sites.set(id,row);
}
for (const [id, row] of [...sites].sort((a,b) => b[1].count-a[1].count)) {
  console.log(id, row.count, id === 'frame/backend' ? '' : showStmt(st,id), row.insns.join(', '));
}
