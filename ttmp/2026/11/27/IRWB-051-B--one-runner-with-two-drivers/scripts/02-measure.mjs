// Run from the worktree root after npm run build.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const load = path => import(pathToFileURL(resolve(path)));
const { installVendor } = await load('tools/node-vendor.mjs');
await installVendor();
const { projectFiles } = await load('tools/corpus.mjs');
const { projectSource } = await load('dist/typed/project.js');
const { Program } = await load('dist/typed/program.js');
const { constprop, constpropTransformation } = await load('dist/typed/passes.js');
const { inlinePass, inlineTransformation } = await load('dist/tensor/passes.js');
const { compileTix } = await load('dist/tensor/index.js');
const { AnalysisManager } = await load('dist/framework/contracts/index.js');
const { applyNativePassSync, applyPass, runTransformation, runTransformationSync } = await load('dist/framework/passes/index.js');

const attention = compileTix(readFileSync('corpus/tensor/attention/main.tix','utf8')).current;
const typed = Program.fromProject(projectSource('constants',projectFiles('constants'))).artifact();
const ok = () => ({ok:true});
const control = tx => ({...tx,obligations:{...tx.obligations,ensures:ok}});
const inline = control(inlineTransformation), propagation = control(constpropTransformation());
const manager = new AnalysisManager();
const cold = () => ({manager:new AnalysisManager(),auditPreservation:true});
const tests = {
  attention: [
    () => applyNativePassSync(inlinePass,attention,ok),
    () => runTransformationSync(inline,attention,{manager}),
    () => runTransformation(inline,attention,{manager}),
  ],
  constants: [
    () => applyPass(constprop,typed,cold()),
    () => runTransformationSync(propagation,typed,cold()),
    () => runTransformation(propagation,typed,cold()),
  ],
};
const orders = [[0,1,2],[1,2,0],[2,0,1],[2,1,0],[1,0,2],[0,2,1]];
for (const [fixture,runs] of Object.entries(tests)) {
  const warm = await Promise.all(runs.map(f => f()));
  assert.ok(warm.every(r => r.changed && r.artifact.revision === warm[0].artifact.revision));
  const timings = runs.map(() => []);
  for (const order of orders) for (const i of order) {
    const start = performance.now();
    for (let iteration=0;iteration<50;iteration++) {
      const result = runs[i]();
      if (result instanceof Promise) await result;
    }
    timings[i].push((performance.now()-start)/50);
  }
  for (const [i,samples] of timings.entries()) {
    const sorted = samples.toSorted((a,b) => a-b);
    console.log(fixture,['stock','sync','async'][i], 'ms/app median',((sorted[2]+sorted[3])/2).toFixed(3),
      'batches',samples.map(x => x.toFixed(3)).join(' '));
  }
}
