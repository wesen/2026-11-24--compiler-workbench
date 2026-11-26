// Run from the repository root after npm run build. No network or GPU.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const C = await import(pathToFileURL(resolve('dist/framework/contracts/index.js')).href);
const source = C.defineIR({ id: 'probe.source', version: '1', description: 'input', validate() {} });
const target = C.defineIR({ id: 'probe.target', version: '1', description: 'output', validate() {} });
let batches = 0;
const check = C.differential({
  id: 'probe.meaning',
  version: '1',
  description: 'batch',
  inputs: { baseline: source, subject: target },
  baseline: 'baseline',
  subject: 'subject',
  count: 2,
  cases: () => [1, 2],
  run() {
    throw Error('Should delegate');
  },
  baselineKey: ({ baseline }) => baseline.revision,
  subjectKey: subject => subject.revision,
  async decide({ baseline, subject }, cases, todo) {
    batches++;
    await new Promise(r => setImmediate(r));
    return todo.map(i =>
      baseline.value + cases[i] === Number(subject.value) + cases[i]
        ? { v: 'agree' }
        : { v: 'disagree', reason: `case ${i} differs` },
    );
  },
});
const pass = C.defineTransformation({
  id: 'probe.lower',
  version: '1',
  description: 'cross-kind',
  cache: 'never',
  inputs: { input: source, delta: C.Integer },
  outputs: { output: target },
  ensures: [
    {
      invariant: check,
      bindings: { baseline: { from: 'inputs', port: 'input' }, subject: { from: 'outputs', port: 'output' } },
    },
  ],
  run(_ctx, { input, delta }) {
    return { outputs: { output: C.createArtifact(target, 'output', String(input.value + delta)) } };
  },
});
const input = C.createArtifact(source, 'input', 3);
const run = delta => new C.AnalysisManager().execute(pass, { input, delta });
await run(0);
await run(0);
assert.equal(batches, 1);
await assert.rejects(run(1), /2\/2 sampled cases disagree/);
assert.equal(batches, 2);
console.log(
  'Cross-kind execute: accepted; warm replay bypassed batch; changed output was batched and rejected.',
);
