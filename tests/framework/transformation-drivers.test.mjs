import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectIds, projectFiles } from '../../tools/corpus.mjs';
import {
  AnalysisManager,
  defineAnalysis,
  defineTransformation,
  JsonValue,
} from '../../dist/framework/contracts/index.js';
import {
  applyPass,
  applyNativePassSync,
  runTransformation,
  runTransformationSync,
} from '../../dist/framework/passes/index.js';
import { IRStore } from '../../dist/framework/ir/index.js';
import { Program } from '../../dist/typed/program.js';
import { projectSource } from '../../dist/typed/project.js';
import { constprop, constpropTransformation, optimizationContract } from '../../dist/typed/passes.js';
import { compileTix } from '../../dist/tensor/index.js';
import { inlinePass, inlineTransformation } from '../../dist/tensor/passes.js';
import { TixIR } from '../../dist/tensor/ir.js';
import { meaningGate } from '../../dist/tensor/contract.js';

await installVendor();
const options = () => ({ manager: new AnalysisManager(), auditPreservation: true });
const tensorCorpus = new URL('../../corpus/tensor/', import.meta.url);
const tensorInput = name =>
  compileTix(readFileSync(new URL(name + '/main.tix', tensorCorpus), 'utf8')).current;

function compare(expected, actual, id) {
  assert.equal(actual.artifact.revision, expected.artifact.revision, id);
  for (const key of ['changed', 'edits', 'changes', 'correspondence', 'report', 'preserved'])
    assert.deepEqual(actual[key], expected[key], id + ' ' + key);
}

test('inline under both drivers agrees with the native runner across the tensor corpus', async () => {
  for (const id of readdirSync(tensorCorpus)) {
    const input = tensorInput(id);
    const expected = applyNativePassSync(inlinePass, input, meaningGate(input, 'exact'));
    compare(expected, runTransformationSync(inlineTransformation, input, options()), id);
    compare(expected, await runTransformation(inlineTransformation, input, options()), id);
  }
});

test('constprop under both drivers agrees with the checked async runner across the Typed corpus', async t => {
  const changed = [],
    identities = [];
  for (const id of projectIds()) {
    const program = Program.fromProject(projectSource(id, projectFiles(id)));
    assert.equal(program.status, 'ok', id);
    const input = program.artifact(),
      params = { inputs: program.options.inputs, roots: program.options.entries };
    const tx = constpropTransformation(params);
    const expected = await applyPass(constprop, input, {
      ...options(),
      contract: optimizationContract(params),
      contractInputs: { origin: input },
    });
    compare(expected, runTransformationSync(tx, input, options()), id);
    compare(expected, await runTransformation(tx, input, options()), id);
    (expected.changed ? changed : identities).push(id);
  }
  assert.ok(changed.length && identities.length);
  t.diagnostic(changed.length + ' changed, ' + identities.length + ' identities');
});

test('cold records cross drivers, hit the same object, and follow invalidation', async () => {
  const manager = new AnalysisManager(),
    input = tensorInput('attention');
  let calls = 0;
  const def = defineAnalysis({
    id: 'spike.count',
    version: '1',
    description: 'function count',
    input: TixIR,
    output: JsonValue,
    run: (_ctx, subject) => {
      calls++;
      return subject.value.functions.length;
    },
  });
  const first = manager.analyseSync(def, input);
  assert.equal(await manager.analyse(def, input), first);
  assert.equal(calls, 1);
  manager.invalidate(def, input, 'test');
  const next = await manager.analyse(def, input);
  assert.equal(manager.analyseSync(def, input), next);
  assert.notEqual(next.id, first.id);
  assert.equal(calls, 2);
  const asyncDef = defineAnalysis({ ...def, id: 'spike.promise', run: async () => 1 });
  assert.throws(() => manager.analyseSync(asyncDef, input), /immediate result/);
  assert.equal(manager.hasAnalysis(asyncDef, input), false);
});

test('both drivers reject a false preservation claim before publication', async () => {
  const input = tensorInput('attention');
  const def = defineAnalysis({
    id: 'spike.revision',
    version: '1',
    description: 'revision',
    input: TixIR,
    output: JsonValue,
    run: (_ctx, a) => a.revision,
  });
  const tx = {
    ...inlineTransformation,
    obligations: { ...inlineTransformation.obligations, preserves: [def] },
  };
  const candidate = runTransformationSync(inlineTransformation, input, options()).artifact;
  const contract = defineTransformation({
    id: 'spike.deferred',
    version: '1',
    description: 'F33 execution',
    inputs: { input: TixIR },
    outputs: { output: TixIR },
  });
  for (const run of [runTransformationSync, runTransformation]) {
    const store = new IRStore(),
      manager = new AnalysisManager();
    await assert.rejects(
      async () =>
        run(tx, input, {
          manager,
          store,
          auditPreservation: true,
          contract: run === runTransformation ? contract : undefined,
        }),
      { code: 'preserveViolated' },
    );
    assert.equal(store.head(input.id).revision, input.revision);
    assert.equal(manager.hasAnalysis(def, candidate), false);
    if (run === runTransformation) assert.equal(manager.snapshot().executions.at(-1).status, 'rolled-back');
  }
});
