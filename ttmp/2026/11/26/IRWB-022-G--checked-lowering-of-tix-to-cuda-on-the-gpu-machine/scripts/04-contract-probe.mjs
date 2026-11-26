// From repository root, after npm run build. No GPU calls or lowering implementation.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { AnalysisManager, defineTransformation, defineType, differential, differentialStats } =
  await import(pathToFileURL(resolve('dist/framework/contracts/index.js')));
const { compileTix } = await import(pathToFileURL(resolve('dist/tensor/index.js')));
const { TixIR } = await import(pathToFileURL(resolve('dist/tensor/ir.js')));
const txt = defineType({ id: 'probe.text', version: '1', description: 'Scalar output',
  validate(x) { if (typeof x !== 'string') throw Error('not a string'); } });
const check = differential({ id: 'probe.diff', version: '1', description: 'Batch over unlike ports',
  inputs: { src: TixIR, unit: txt }, baseline: 'src', subject: 'unit', count: 2,
  cases: () => ['c0','c1'], baselineKey: i => i.src.revision, subjectKey: unit => unit,
  run() { throw Error('There is no synchronous engine'); }, compare() { throw Error('unused'); },
  async decide({ unit }, cases, todo) {
    console.log(unit, todo);
    return todo.map(i => unit === 'wrong' && i === 1 ? { v: 'disagree', reason: cases[i] } : { v: 'agree' });
  } });
const pass = defineTransformation({ id: 'probe.lower', version: '1', description: 'Different output kind',
  inputs: { src: TixIR }, outputs: { unit: txt }, cache: 'never', ensures: [{ invariant: check,
    bindings: { src: { from: 'inputs', port: 'src' }, unit: { from: 'outputs', port: 'unit' } } }] });
const src = compileTix('fn f(x:f32[N]):f32[N]{return x;}').current, m = new AnalysisManager();
for (const unit of ['right','right','wrong']) {
  try { console.log('commit:', (await m.verifyTransformation({ src }, { unit }, pass)).execution.status); }
  catch (e) { if (unit !== 'wrong') throw e; console.log('reject:', e.message); }
}
console.log(differentialStats());
