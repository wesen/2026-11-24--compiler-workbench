import { AnalysisManager, defineTransformation, differential, differentialStats, JsonValue }
  from '../../../../../../dist/framework/contracts/index.js';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { TixIR } from '../../../../../../dist/tensor/ir.js';
const { current } = compileTix('fn f(a:f32[N]):f32[N]{return a;}');
const ports = { baseline: TixIR, fn: JsonValue, subject: JsonValue };
const check = differential({
  id: 'probe.cuda', version: '1', description: 'Batch and replay probe', inputs: ports,
  baseline: 'baseline', subject: 'subject', seed: 20, count: 2,
  cases: () => [1, 2], baselineKey: p => p.baseline.revision + p.fn, subjectKey: x => x,
  run() { throw Error('unexpected local dispatch'); }, compare: Object.is,
  async decide(_inputs, _cases, todo) {
    console.log('batch', todo);
    return todo.map(() => ({ v: 'agree' }));
  },
});
const pass = defineTransformation({
  id: 'probe.lower', version: '1', description: 'Typed source to text',
  inputs: { baseline: TixIR, fn: JsonValue }, outputs: { subject: JsonValue }, cache: 'never',
  ensures: [{ invariant: check, bindings: {
    baseline: { from: 'inputs', port: 'baseline' }, fn: { from: 'inputs', port: 'fn' },
    subject: { from: 'outputs', port: 'subject' },
  } }],
  run: () => ({ outputs: { subject: 'probe output' } }),
});
for (let i = 0; i < 2; i++) await new AnalysisManager().execute(pass, { baseline: current, fn: 'f' });
console.log(differentialStats());
