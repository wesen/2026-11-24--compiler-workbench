import assert from 'node:assert/strict';
import {
  AnalysisManager,
  JsonValue,
  createArtifact,
  defineIR,
  defineTransformation,
  differential,
  differentialStats,
} from '../../../../../../dist/framework/contracts/index.js';

const Tix = defineIR({ id: 'probe.tix', version: '1', description: 'Input', validate() {} });
const CUDA = defineIR({ id: 'probe.cuda', version: '1', description: 'Output', validate() {} });
const origin = createArtifact(Tix, 'origin', { coefficient: 1 });
const output = createArtifact(CUDA, 'cuda', { source: 'generated source' });
const wrong = createArtifact(CUDA, 'cuda', { source: 'different source' });
let producedCases = 0;
const batches = [];
const invariant = differential({
  id: 'probe.lowering-check',
  version: '1',
  description: 'Sample an asynchronous target with two artifact types',
  inputs: { baseline: Tix, subject: CUDA, engine: JsonValue },
  baseline: 'baseline',
  subject: 'subject',
  count: 2,
  cases: () => (++producedCases, [10, 20]),
  run: () => assert.fail('Async batch should decide every miss'),
  compare: (a, b) => a === b,
  baselineKey: ({ baseline }) => baseline.revision,
  subjectKey: (subject, _case, { engine }) => subject.revision + '/' + engine,
  async decide({ subject, engine }, cases, todo) {
    batches.push({ engine, inputs: todo.map(i => cases[i]) });
    await Promise.resolve();
    return todo.map(() =>
      subject.revision === output.revision ? { v: 'agree' } : { v: 'disagree', reason: 'changed code' },
    );
  },
});
const pass = defineTransformation({
  id: 'probe.lowering',
  version: '1',
  description: 'Check a cross-kind lowering',
  inputs: { input: Tix, engine: JsonValue },
  outputs: { output: CUDA },
  cache: 'never',
  ensures: [
    {
      invariant,
      bindings: {
        baseline: { from: 'inputs', port: 'input' },
        subject: { from: 'outputs', port: 'output' },
        engine: { from: 'inputs', port: 'engine' },
      },
    },
  ],
});
const check = (engine, candidate) =>
  new AnalysisManager().verifyTransformation({ input: origin, engine }, { output: candidate }, pass);
await check('stack-a', output);
await check('stack-a', output);
await check('stack-b', output);
await assert.rejects(check('stack-a', wrong), /disagree/);
assert.equal(producedCases, 1);
assert.deepEqual(
  batches.map(b => b.inputs),
  [
    [10, 20],
    [10, 20],
    [10, 20],
  ],
);
assert.equal(differentialStats().delegated, 6);
assert.equal(differentialStats().replayed, 2);
console.log(
  JSON.stringify({ producedCases, batches, stats: differentialStats(), changedCodeRejected: true }),
);
