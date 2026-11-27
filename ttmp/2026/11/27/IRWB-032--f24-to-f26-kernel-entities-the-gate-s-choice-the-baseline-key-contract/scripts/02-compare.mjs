import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { transform } from 'esbuild';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { differentialSpec, seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import * as current from '../../../../../../dist/framework/contracts/differential.js';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { cudaCases, seed } from '../../../../../../dist/tensor/contract.js';

// Reconstruct the immediately preceding implementation, with its reuse-hit check removed, to measure the
// increment in the same process. The recorded revision keeps this comparison reproducible after later commits.
let source = execFileSync('git', ['show', '4f929dd:src/framework/contracts/differential.ts'], { encoding: 'utf8' });
const previous = `if (reuse) {\n    const current = spec.cases(inputs, (spec.random ?? seededRandom)(seed), spec.count);\n    if (!isDeepStrictEqual(reuse.cases, current)) throw new Error(\`Differential baseline key \${bk} produced different cases\`);\n    REUSE.delete(key);\n  }`;
if (!source.includes(previous)) throw Error('Baseline source changed');
source = source.replace(previous, 'if (reuse) REUSE.delete(key);');
const definitionUrl = new URL('../../../../../../dist/framework/contracts/definitions.js', import.meta.url).href;
source = source.replace("'./definitions.js'", JSON.stringify(definitionUrl));
const js = await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' });
const baseline = await import('data:text/javascript;base64,' + Buffer.from(js.code).toString('base64'));
await installVendor();
const { projectSource, ingestProject } = await import('../../../../../../dist/typed/project.js');
const { meaningKept } = await import('../../../../../../dist/typed/evaluate.js');
const project = projectSource('blend', projectFiles('blend'));
const origin = ingestProject(project);
const typed = differentialSpec(meaningKept({ inputs: project.meta.inputs }));
const fn = compileTix('fn f(x:f32[N,C]):f32[N,C] { s[i]=sum(j) x[i,j]; y[i,j]=x[i,j]-s[i]; return y; }').current.value.functions[0];
const tensor = { id:'measurement.tensor', version:'1', count:1, seed, baseline:'a', subject:'b', baselineKey:()=> 'same', subjectKey:()=> 'same', cases:()=>cudaCases(fn, seededRandom(seed)), run:()=>0, compare:()=>true };
for (const [name, spec, inputs] of [['typed', typed, { origin, candidate: origin }], ['tensor', tensor, { a: null, b: null }]]) {
  for (const [label, engine] of [['without detection', baseline], ['with detection', current]]) {
    engine.setDifferentialReuse(false); engine.setDifferentialReuse(true);
    engine.runDifferential(spec, inputs);
    const start = performance.now();
    for (let i = 0; i < 20; i++) engine.runDifferential(spec, inputs);
    console.log(name, label, ((performance.now() - start) / 20).toFixed(3), 'ms/check');
  }
}
