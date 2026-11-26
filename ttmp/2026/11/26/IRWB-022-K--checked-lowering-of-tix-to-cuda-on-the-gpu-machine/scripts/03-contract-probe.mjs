import assert from 'node:assert/strict';
import {
  AnalysisManager, defineTransformation, defineType, differential, differentialStats, Integer,
} from '../../../../../../dist/framework/contracts/index.js';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { TixIR } from '../../../../../../dist/tensor/ir.js';

// Stand-in evaluator to test dispatch and cache semantics independently of CUDA.
const s = defineType({ id: 'probe.text', version: '1', description: 'Candidate text', validate(x) {
  assert.equal(typeof x, 'string');
} });
const calls = [];
const inv = differential({
  id: 'probe.relation', version: '1', description: 'Delegation probe',
  inputs: { baseline: TixIR, subject: s, n: Integer },
  baseline: 'baseline', subject: 'subject', count: 2, seed: 20,
  cases: () => [0, 1], baselineKey: p => p.baseline.revision, subjectKey: s => s,
  run: (side, value, i) => side === 'subject' && value === 'bad' && i === 1 ? 0 : 1,
  compare: (a, b) => a === b || { ok: false, reason: 'wrong sample' },
  async decide(p, cases, todo) {
    calls.push([...todo]);
    return todo.map(i => p.subject === 'bad' && cases[i] === 1
      ? { v: 'disagree', reason: 'wrong sample' } : { v: 'agree' });
  },
});
const tx = defineTransformation({
  id: 'probe.lower', version: '1', description: 'Artifact to text', inputs: { program: TixIR, n: Integer },
  outputs: { source: s },
  ensures: [{ invariant: inv, bindings: { baseline: { from: 'inputs', port: 'program' },
    subject: { from: 'outputs', port: 'source' }, n: { from: 'inputs', port: 'n' } } }],
  run: (_, { n }) => ({ outputs: { source: n ? 'bad' : 'good' } }),
});
const m = new AnalysisManager();
const program = compileTix('fn f(x:f32[N]):f32[N]{return x;}').current;
for (let i = 0; i < 2; i++) await m.execute(tx, { program, n: 0 });
await assert.rejects(m.execute(tx, { program, n: 1 }), e => e.code === 'postcondition');
assert.deepEqual(calls, [[0, 1], [0, 1]]);
const stats = differentialStats();
assert.equal(stats.replayed, 2);
console.log({ calls, ...stats });
