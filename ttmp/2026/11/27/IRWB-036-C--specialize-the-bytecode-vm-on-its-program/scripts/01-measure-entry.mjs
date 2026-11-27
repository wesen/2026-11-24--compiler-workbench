import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { BindingsIR } = await import('../../../../../../dist/typed/specialize.js');
const { createArtifact } = await import('../../../../../../dist/framework/contracts/index.js');
const { lowerToImage, runImage } = await import('../../../../../../dist/typed/backend/index.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const cells = project.meta.inputs.runVm.code.cells;
const hand = `function seededFib(n: i32, seed: i32): i32 {
  let a = 0; let b = seed;
  for (let remaining = n; remaining > 0; remaining = remaining - 1) {
    const next = a + b; a = b; b = next;
  }
  return a;
}
function rollingChecksum(n: i32, seed: i32): i32 {
  let h = seed;
  for (let remaining = n; remaining > 0; remaining = remaining - 1) {
    h = h * 33 + remaining;
  }
  return h;
}`;
const hp = Program.fromProject(projectSource('hand-vm', {'main.typed': hand, 'project.json': JSON.stringify({inputs:{seededFib:{n:[0,12],seed:[-8,8]},rollingChecksum:{n:[0,12],seed:[-8,8]}}})}));
await hp.pipeline('speed');
const hi = lowerToImage(hp.head, { coalesce: true }).image.value;
const out = [];
for (const entry of [0, 34]) {
  const general = Program.fromProject(project);
  const original = lowerToImage(general.head, { coalesce: true }).image.value;
  await general.pipeline('speed');
  const base = lowerToImage(general.head, { coalesce: true }).image.value;
  const p = Program.fromProject(project);
  const facts = createArtifact(BindingsIR, `entry-${entry}`, {formatVersion:1,source:'measurement',bindings:[{fn:'runVm',param:'entry',value:entry,entity:`entry/${entry}`}]});
  const change = await p.specialize(facts);
  await p.pipeline('speed');
  const spec = lowerToImage(p.head, { coalesce: true }).image.value;
  const call = benchCase(storeOf(p.head.value), 'runVm', {code:{cells},entry,n:12,seed:8});
  const fn = entry === 0 ? 'seededFib' : 'rollingChecksum';
  const hc = benchCase(storeOf(hp.head.value), fn, {n:12,seed:8});
  const run = image => runImage(image, call.fn, call.args, call.memory, {counts:false});
  const initial = run(original), before = run(base), after = run(spec), handwritten = runImage(hi, hc.fn, hc.args, hc.memory, {counts:false});
  out.push({entry, changed:change.changed, check:p.check({fn:'runVm'}), original:{steps:initial.steps,bytes:original.fns.runVm.bytes,result:initial.result}, general:{steps:before.steps,bytes:base.fns.runVm.bytes,result:before.result}, scalar:{steps:after.steps,bytes:spec.fns.runVm.bytes,result:after.result}, hand:{steps:handwritten.steps,bytes:hi.fns[fn].bytes,result:handwritten.result}});
}
console.log(JSON.stringify(out,null,2));
