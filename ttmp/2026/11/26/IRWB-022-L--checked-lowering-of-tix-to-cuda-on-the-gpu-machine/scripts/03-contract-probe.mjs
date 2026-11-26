// Probe the framework boundary with three local stand-ins for remote cases.
import assert from 'node:assert/strict';
import {
  AnalysisManager,
  defineTransformation,
  defineType,
  differential,
  differentialStats,
} from '../../../../../../dist/framework/contracts/index.js';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { TixIR } from '../../../../../../dist/tensor/ir.js';

const { current } = compileTix('fn f(x:f32[N]):f32[N] { return x; }');
const text = defineType({
  id: 'probe.text',
  version: '1',
  description: 'String port',
  validate(v) {
    assert.equal(typeof v, 'string');
  },
});
const batches = [];
const relation = differential({
  id: 'probe.gpu',
  version: '1',
  description: 'Batch three case indices',
  inputs: { baseline: TixIR, subject: text, fn: text },
  baseline: 'baseline',
  subject: 'subject',
  count: 3,
  seed: 22,
  cases: () => [0, 1, 2],
  baselineKey: ({ baseline, fn }) => baseline.revision + '/' + fn,
  subjectKey: source => source,
  run() {
    throw Error('unexpected fallback');
  },
  compare: Object.is,
  async decide({ subject }, _cases, todo) {
    batches.push([...todo]);
    return todo.map(i =>
      subject === 'wrong' && i === 1 ? { v: 'disagree', reason: 'case 1' } : { v: 'agree' },
    );
  },
});
const contract = defineTransformation({
  id: 'probe.lower',
  version: '1',
  description: 'Tix artifact to source text',
  inputs: { origin: TixIR, current: TixIR, fn: text },
  outputs: { source: text },
  ensures: [
    {
      invariant: relation,
      bindings: {
        baseline: { from: 'inputs', port: 'origin' },
        fn: { from: 'inputs', port: 'fn' },
        subject: { from: 'outputs', port: 'source' },
      },
    },
  ],
});
const manager = new AnalysisManager();
const check = source =>
  manager.verifyTransformation({ origin: current, current, fn: 'f' }, { source }, contract);
const first = await check('right');
await check('right');
await assert.rejects(check('wrong'), /disagree/);
const stats = differentialStats();
assert.equal(stats.delegated, 6);
assert.equal(stats.replayed, 3);
assert.deepEqual(batches, [
  [0, 1, 2],
  [0, 1, 2],
]);
console.log(
  JSON.stringify({
    batches,
    stats,
    cold: first.execution.status,
    executions: manager.snapshot().executions.map(e => e.status),
  }),
);
