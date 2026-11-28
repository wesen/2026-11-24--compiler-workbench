// IRWB-064 (v7 report): the record chain for first-steps under O1, from the mul-pow2 derivation step to the RV32
// instructions that cover the rewritten value. Read-only; run from the repository root after `npm run build`.
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';
await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const B = await import('../../../../../../dist/typed/backend/index.js');
const p = Program.fromProject(projectSource('first-steps', projectFiles('first-steps')));
await p.pipeline('O1');
console.log('revisions:', p.revisions.map(r => `r${r.rev} ${r.pass ?? 'ingest'}`).join(', '));
const r3 = p.revisions.find(r => r.pass === 'simplify' && r.derivation?.steps?.some(s => s.by?.rule === 'mul-pow2'));
const step = r3.derivation.steps.find(s => s.by?.rule === 'mul-pow2');
console.log('step:', JSON.stringify(step));
const lowered = B.lowerToImage(p.head);
const img = lowered.image.value, f = img.fns.scale;
const insns = img.insns.filter(i => i.offset >= f.entry && i.offset < f.entry + f.bytes);
for (const i of insns) console.log(String(i.offset).padStart(4), i.text.padEnd(22), JSON.stringify(i.covers), i.why ?? '');
const corr = lowered.correspondence.entries.filter(e => e.from.some(x => ['v:scale.12', 'v:scale.13', 'v:scale.14'].includes(x)));
console.log('lowering correspondence:', JSON.stringify(corr));

// the values of `scale` at the head, so the reader can see which id is the shift and which its constant
const vals = p.head.value.values ?? {};
for (const id of ['v:scale.3', 'v:scale.9', 'v:scale.10', 'v:scale.11', 'v:scale.12', 'v:scale.13', 'v:scale.14'])
  if (vals[id]) console.log(id.padEnd(11), JSON.stringify({ op: vals[id].op, args: vals[id].args, value: vals[id].value }));
for (const s of r3.derivation.steps) console.log('r3 step', JSON.stringify({ by: s.by, consumes: s.consumes, produces: s.produces, note: s.note }));
