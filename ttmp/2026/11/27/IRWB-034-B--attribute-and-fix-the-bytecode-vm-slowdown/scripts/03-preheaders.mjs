import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { Program } from '../../../../../../dist/typed/program.js';
import { projectSource } from '../../../../../../dist/typed/project.js';
import { benchCase } from '../../../../../../dist/typed/evaluate.js';
import { storeOf } from '../../../../../../dist/typed/ir.js';
import { attributeInstructions } from '../../../../../../dist/typed/attribution.js';
import { loopsOf } from '../../../../../../dist/typed/analyses.js';

await installVendor();
const p = Program.fromProject(projectSource('bytecode-vm', projectFiles('bytecode-vm')));
await p.pipeline('speed');
for (const entry of [0,34]) {
  const c = benchCase(storeOf(p.origin.value), 'runVm', {code:p.inputs.runVm.code, entry, n:12, seed:8});
  const profile = attributeInstructions(p.revisions,c,{coalesce:true});
  const licm = profile.find(r => r.pass === 'licm');
  if (!licm) continue;
  const before = storeOf(p.revisions[licm.rev-1].artifact.value);
  const loops = loopsOf(before,before.fn('runVm'));
  const blocks = licm.edits.filter(e=>e.kind==='block');
  console.log({entry, latches:loops.map(l=>l.latch)});
  for (const {block} of blocks) {
    const site = new Set(licm.edits.filter(e=>e.kind==='insert' && e.block===block).map(e=>e.stmt));
    const words = licm.instructions.filter(({insn})=>insn.covers.some(id=>site.has(id)));
    console.log(block,words.map(({insn,executions})=>[insn.sym,executions,insn.covers]));
  }
  const example = licm.instructions.find(({insn})=>insn.covers.includes(licm.edits.find(e=>e.kind==='insert' && e.stmt === 's:runVm.144').stmt));
  if(example) console.log('one path',JSON.stringify(licm.explain(example.insn.id)));
}
