import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { AnalysisManager, defineAnalysis } from '../../dist/framework/contracts/index.js';
import { IRStore } from '../../dist/framework/ir/index.js';
import {
  applyNativePassSync,
  applyPass,
  applyTransformation,
  applyTransformationSync,
  semanticCorrespondence,
} from '../../dist/framework/passes/index.js';
import { meaningGate } from '../../dist/tensor/contract.js';
import { compileTix } from '../../dist/tensor/index.js';
import { inlinePass, inlineTransformation } from '../../dist/tensor/passes.js';
import { cfgAnalysis, reachingAnalysis } from '../../dist/typed/analyses.js';
import { constprop, constpropTransformation, optimizationContract } from '../../dist/typed/passes.js';
import { Program } from '../../dist/typed/program.js';
import { projectSource } from '../../dist/typed/project.js';
import { projectFiles, projectIds } from '../../tools/corpus.mjs';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor();

function compareResult(actual, expected) {
  for (const field of ['changed', 'edits', 'changes', 'correspondence', 'preserved', 'report'])
    assert.deepEqual(actual[field], expected[field], field);
  assert.equal(actual.artifact.revision, expected.artifact.revision);
}

const tensorCorpus = new URL('../../corpus/tensor/', import.meta.url);
for (const dir of readdirSync(tensorCorpus, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
  test(`Tix inline on ${dir.name} matches the native runner`, async () => {
    const { origin } = compileTix(readFileSync(new URL(`${dir.name}/main.tix`, tensorCorpus), 'utf8'));
    const expected = applyNativePassSync(inlinePass, origin, meaningGate(origin, inlinePass.relation));
    for (const apply of [applyTransformationSync, applyTransformation]) {
      const result = await apply(inlineTransformation, origin, { manager: new AnalysisManager(), origin });
      compareResult(result, expected);
      assert.deepEqual(result.contract, expected.contract);
    }
  });
}

function typedProject(id) {
  return Program.fromProject(projectSource(id, projectFiles(id)));
}

for (const id of projectIds()) {
  test(`Typed constprop on ${id} matches applyPass`, async t => {
    const program = typedProject(id);
    if (program.status !== 'ok') {
      t.skip(program.error.message);
      return;
    }
    const origin = program.artifact();
    const meaning = { inputs: program.inputs, roots: program.options.entries };
    const options = { origin, auditPreservation: true };
    const expected = await applyPass(constprop, origin, {
      ...options,
      manager: new AnalysisManager(),
      contract: optimizationContract(meaning),
      contractInputs: { origin },
    });
    for (const apply of [applyTransformationSync, applyTransformation]) {
      const result = await apply(constpropTransformation(meaning), origin, {
        ...options,
        manager: new AnalysisManager(),
      });
      compareResult(result, expected);
      if (expected.changed) {
        assert.equal(result.preserved.length, 3);
        const check = expected.contract.execution.checks.find(check => check.phase === 'ensures');
        assert.deepEqual(result.contract.evidence, check.evidence);
      }
    }
  });
}

test('analyseSync and analyse share cache identity, history, and invalidation', async () => {
  const initial = typedProject('constants').artifact();
  const manager = new AnalysisManager();
  const sync = manager.analyseSync(reachingAnalysis, initial);
  assert.equal(await manager.analyse(reachingAnalysis, initial), sync);
  manager.invalidate(reachingAnalysis, initial, 'test invalidation');
  const async = await manager.analyse(reachingAnalysis, initial);
  assert.notEqual(async.id, sync.id);
  assert.equal(async.generation, sync.generation + 1);
  assert.equal(manager.analyseSync(reachingAnalysis, initial), async);
  assert.deepEqual(
    manager
      .snapshot()
      .analyses.map(record => record.id)
      .sort(),
    [sync.id, async.id].sort(),
  );
});

test('both drivers keep a rejected candidate out of the caller store', async () => {
  const { origin } = compileTix(readFileSync(new URL('attention/main.tix', tensorCorpus), 'utf8'));
  const tx = {
    ...inlineTransformation,
    obligations: {
      ...inlineTransformation.obligations,
      ensures: () => ({ ok: false, reason: 'deliberate refusal' }),
    },
  };
  for (const apply of [applyTransformationSync, applyTransformation]) {
    const store = new IRStore();
    await assert.rejects(
      async () => apply(tx, origin, { manager: new AnalysisManager(), origin, store }),
      /deliberate refusal/,
    );
    assert.equal(store.head(origin.id).revision, origin.revision);
    assert.deepEqual(
      store.revisions(origin.id).map(artifact => artifact.revision),
      [origin.revision],
    );
  }
});

test('pure transfers made synchronously are visible to the asynchronous manager', async () => {
  const before = typedProject('constants').artifact();
  const manager = new AnalysisManager();
  const result = applyTransformationSync(constpropTransformation(), before, { origin: before, manager });
  const def = defineAnalysis({
    ...cfgAnalysis,
    id: 'test.sync-transfer',
    transfer: { id: 'test.values-only', version: '1', verify: () => ({ ok: true }) },
  });
  const source = await manager.analyse(def, before);
  const record = manager.preserveSync(
    def,
    before,
    result.artifact,
    semanticCorrespondence(result.correspondence),
  );
  assert.equal(record.transfer.sourceRecord, source.id);
  assert.equal(await manager.analyse(def, result.artifact), record);
});

test('an async analysis cache miss publishes no record through analyseSync', async () => {
  const before = typedProject('constants').artifact();
  const manager = new AnalysisManager();
  const def = defineAnalysis({
    ...cfgAnalysis,
    id: 'test.async-analysis',
    run: async (...args) => cfgAnalysis.run(...args),
  });
  assert.throws(() => manager.analyseSync(def, before), /requires a synchronous callback/);
  assert.equal(manager.hasAnalysis(def, before), false);
  assert.equal(manager.snapshot().analyses.length, 0);
  assert.equal((await manager.analyse(def, before)).generation, 1);
});
