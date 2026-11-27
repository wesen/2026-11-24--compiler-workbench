import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/typed/';
const {rule, op, c, v} = await import(D + 'rules/form.js');
const {verifyRule} = await import(D + 'rules/verify.js');
const {tableBody} = await import(D + 'rules/compile.js');
const {typedPass, PIPELINES} = await import(D + 'passes.js');
const {Program} = await import(D + 'program.js');
const {projectSource} = await import(D + 'project.js');
const {storeOf} = await import(D + 'ir.js');
const {benchCase} = await import(D + 'evaluate.js');
const {lowerToImage, runImage} = await import(D + 'backend/index.js');
const r = rule('five-times', {x:'i32'}, op('mul',c(5),v('x')),op('add',v('x'),op('shl',v('x'),c(2))),
  {where:[{pure:'x'}]});
const evidence = verifyRule(r);
console.log(JSON.stringify(evidence));
if (evidence.verdict !== 'sound') throw new Error('candidate failed verification');
const firings = new Map();
const pass = typedPass({name:'five-times',about:r.about,writes:['values'],body:tableBody([r],firings)});
for (const candidate of [false,true]) {
  const p = Program.fromProject(projectSource('regex-nfa',projectFiles('regex-nfa')));
  for (const name of PIPELINES.speed) {
    await p.apply(name);
    if (candidate && name === 'strength') await p.apply(pass);
  }
  const fn = 'regexMatch';
  const k = benchCase(storeOf(p.origin.value),fn,{pattern:{string:'[a-c]*[b-d]*a*d'},text:{string:'abccabbd'}});
  console.log(JSON.stringify({candidate,firings:[...firings],
    instructions:runImage(lowerToImage(p.head).image,fn,k.args,k.memory).steps}));
}
