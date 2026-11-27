import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AnalysisManager,
  createArtifact,
  defineIR,
  defineTransformation,
} from '../../dist/framework/contracts/index.js';
import { makeCorrespondence } from '../../dist/framework/ir/correspondence.js';
import { semanticCorrespondence } from '../../dist/framework/passes/define-pass.js';

function fixture(enumerate = true) {
  const type = defineIR({
    id: `entities-${enumerate}`,
    version: '1',
    description: 'Entity list',
    validate() {},
    ...(enumerate ? { entities: value => value } : {}),
  });
  const from = createArtifact(type, 'source', ['s1', 's2']);
  const to = createArtifact(type, 'target', ['t1', 't2']);
  const contract = defineTransformation({
    id: `mapping-${enumerate}`,
    version: '1',
    description: 'Mapping',
    inputs: { from: type },
    outputs: { to: type },
    correspondence: [{ id: 'entities', from: 'from', to: 'to' }],
  });
  const verify = (source, target) => {
    const c = makeCorrespondence(
      { artifact: from.id, revision: from.revision },
      { artifact: to.id, revision: to.revision },
      source,
      target,
    );
    return new AnalysisManager().verifyTransformation({ from }, { to }, contract, [
      semanticCorrespondence(c),
    ]);
  };
  return { verify };
}

test('enumerated correspondence rejects a made-up source ID', async () => {
  await assert.rejects(fixture().verify(['s1', 's2', 'fake-source'], ['t1', 't2']), /fake-source/);
});
test('enumerated correspondence rejects a made-up target ID', async () => {
  await assert.rejects(fixture().verify(['s1', 's2'], ['t1', 't2', 'fake-target']), /fake-target/);
});
test('enumerated correspondence rejects omitted real IDs', async () => {
  await assert.rejects(fixture().verify(['s1'], ['t1', 't2']), /s2/);
  await assert.rejects(fixture().verify(['s1', 's2'], ['t1']), /t2/);
});
test('types without enumeration retain self-declared correspondence behavior', async () => {
  await fixture(false).verify(['invented'], []);
  await fixture().verify(['s2', 's1'], ['t2', 't1']);
});

test('direct correspondences reject unknown entry IDs on enumerated sides', async () => {
  const type = defineIR({
    id: 'direct-entities',
    version: '1',
    description: 'Entity list',
    validate() {},
    entities: value => value,
  });
  const from = createArtifact(type, 'source', ['s1', 's2']);
  const to = createArtifact(type, 'target', ['t1', 't2']);
  const contract = defineTransformation({
    id: 'direct-mapping',
    version: '1',
    description: 'Mapping',
    inputs: { from: type },
    outputs: { to: type },
    correspondence: [{ id: 'entities', from: 'from', to: 'to' }],
  });
  const verify = (source, target) =>
    new AnalysisManager().verifyTransformation({ from }, { to }, contract, [
      {
        id: 'entities',
        from: { artifact: from.id, revision: from.revision },
        to: { artifact: to.id, revision: to.revision },
        relation: 'lowering',
        sourceEntities: ['s1', 's2'],
        targetEntities: ['t1', 't2'],
        entities: [{ from: source, to: target }],
        evidence: {},
      },
    ]);
  await assert.rejects(verify(['made-up-source'], ['t1']), /made-up-source/);
  await assert.rejects(verify(['s1'], ['made-up-target']), /made-up-target/);
});
