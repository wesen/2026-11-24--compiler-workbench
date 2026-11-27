import { performance } from 'node:perf_hooks';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { differentialSpec, runDifferential, seededRandom, setDifferentialReuse } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { cudaCases, seed } from '../../../../../../dist/tensor/contract.js';
await installVendor();
const { projectSource, ingestProject } = await import('../../../../../../dist/typed/project.js');
const { meaningKept } = await import('../../../../../../dist/typed/evaluate.js');
const project = projectSource('blend', projectFiles('blend'));
const origin = ingestProject(project);
const typed = differentialSpec(meaningKept({ inputs: project.meta.inputs }));
const fn = compileTix('fn f(x:f32[N,C]):f32[N,C] { s[i]=sum(j) x[i,j]; y[i,j]=x[i,j]-s[i]; return y; }').current.value.functions[0];
const tensor = { id:'measurement.tensor', version:'1', count:1, seed, baseline:'a', subject:'b', baselineKey:()=> 'same', subjectKey:()=> 'same', cases:()=>cudaCases(fn, seededRandom(seed)), run:()=>0, compare:()=>true };
for (const [name, spec, inputs] of [['typed', typed, { origin, candidate: origin }], ['tensor', tensor, { a: null, b: null }]]) {
  for (const mode of ['cached cases', 'regenerate cases']) {
    setDifferentialReuse(false); setDifferentialReuse(true);
    const original = spec.cases; let saved;
    const measured = { ...spec, id: spec.id + mode, cases: (...args) => mode === 'cached cases' ? (saved ??= original(...args)) : original(...args) };
    runDifferential(measured, inputs);
    const start = performance.now();
    for (let i=0;i<20;i++) runDifferential(measured, inputs);
    console.log(name, mode, ((performance.now()-start)/20).toFixed(3), 'ms/check');
  }
}
