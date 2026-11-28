// IRWB-056-A: Tix inline records which statement was merged into which, and the correspondence computed from
// those steps replaces the two-projection completion that said `removed` with no link to the consumer (R3 K2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, optimizeTix } from '../../dist/tensor/index.js';
import { meaningGate } from '../../dist/tensor/contract.js';
import { inlinePass } from '../../dist/tensor/passes.js';
import { applyNativePassSync, applyPass } from '../../dist/framework/passes/index.js';
import { makeCorrespondence, correspondenceOfDerivation } from '../../dist/framework/ir/index.js';
import { AnalysisManager } from '../../dist/framework/contracts/index.js';
import { canonical } from '../../dist/framework/core/data.js';

const checked = (p, pass) => applyNativePassSync(pass, p.current, meaningGate(p.origin, 'exact'));

test('inline records the merge, and the correspondence comes from the steps', () => {
  const p = compileTix('fn f(x:f32[N]):f32[N]{a[i]=x[i]*2;b[i]=a[i]+1;return b;}');
  const r = checked(p, inlinePass);
  assert.equal(r.changed, true);
  // which statement was merged into which: the derivation says it
  assert.deepEqual(r.derivation, [
    {
      by: 'inline',
      consumes: ['f/a'],
      produces: ['f/b'],
      premises: ['f/a is pointwise', 'f/a has one use, at f/b'],
      relation: 'merged',
    },
  ]);
  // the runner's correspondence is the one computed from these steps, under the same coverage completion
  assert.equal(
    canonical(r.correspondence),
    canonical(
      correspondenceOfDerivation(
        { artifact: r.before.id, revision: String(r.before.revision) },
        { artifact: r.artifact.id, revision: String(r.artifact.revision) },
        r.correspondence.sourceEntities,
        r.correspondence.targetEntities,
        r.derivation,
      ),
    ),
  );
  assert.deepEqual(r.correspondence.entries, [
    { from: ['f/a'], to: ['f/b'], relation: 'merged', because: ['f/a has one use, at f/b', 'f/a is pointwise'] },
    { from: ['f'], to: ['f'], relation: 'retained' },
    { from: ['f/b'], to: ['f/b'], relation: 'retained' },
    { from: ['f/x'], to: ['f/x'], relation: 'retained' },
  ]);
  // today's two-projection completion said the producer disappeared; the derivation is the only difference
  const todays = makeCorrespondence(
    { artifact: r.before.id, revision: String(r.before.revision) },
    { artifact: r.artifact.id, revision: String(r.artifact.revision) },
    r.correspondence.sourceEntities,
    r.correspondence.targetEntities,
  );
  assert.deepEqual(todays.entries.find(e => e.from[0] === 'f/a'), { from: ['f/a'], to: [], relation: 'removed' });
});

test('a chain of merges resolves to the final survivor', () => {
  const p = compileTix('fn f(x:f32[N]):f32[N]{a[i]=x[i]*2;b[i]=a[i]+1;c[i]=b[i]+3;return c;}');
  const r = checked(p, inlinePass);
  assert.deepEqual(r.derivation, [
    {
      by: 'inline',
      consumes: ['f/a'],
      produces: ['f/c'],
      premises: ['f/a is pointwise', 'f/a has one use, at f/c'],
      relation: 'merged',
    },
    {
      by: 'inline',
      consumes: ['f/b'],
      produces: ['f/c'],
      premises: ['f/b is pointwise', 'f/b has one use, at f/c'],
      relation: 'merged',
    },
  ]);
  assert.deepEqual(
    r.correspondence.entries.filter(e => e.relation === 'merged'),
    [
      { from: ['f/a'], to: ['f/c'], relation: 'merged', because: ['f/a has one use, at f/c', 'f/a is pointwise'] },
      { from: ['f/b'], to: ['f/c'], relation: 'merged', because: ['f/b has one use, at f/c', 'f/b is pointwise'] },
    ],
  );
  // every entity is still accounted for: the intermediate b is removed, the survivor retained
  assert.deepEqual(
    r.correspondence.entries.map(e => `${e.from}>${e.to}:${e.relation}`).sort(),
    ['f/a>f/c:merged', 'f/b>f/c:merged', 'f/c>f/c:retained', 'f/x>f/x:retained', 'f>f:retained'],
  );
});

test('a program with nothing to inline derives nothing and stays unchanged', () => {
  const p = compileTix('fn f(x:f32[1,K]):f32[1]{y[i]=sum(k)x[i,k];return y;}');
  const r = checked(p, inlinePass);
  assert.equal(r.changed, false);
  assert.equal(r.derivation, undefined);
});

test('a derivation naming a statement that does not exist is rejected by the runner', async () => {
  const p = compileTix('fn f(x:f32[N]):f32[N]{a[i]=x[i]*2;b[i]=a[i]+1;return b;}');
  const bad = {
    ...inlinePass,
    prepare: ctx => {
      const out = inlinePass.prepare(ctx);
      return { native: out.native, derivation: [{ ...out.derivation[0], consumes: ['f/zzz'] }] };
    },
  };
  await assert.rejects(applyPass(bad, p.current, { manager: new AnalysisManager() }), /in neither revision/);
});

test('optimizeTix publishes the same revisions as before, with the derivation recorded', () => {
  const p = compileTix('fn f(x:f32[N]):f32[N]{a[i]=x[i]*2;b[i]=a[i]+1;return b;}');
  const out = optimizeTix(p, ['inline']);
  assert.deepEqual(out.steps, [{ pass: 'inline', accepted: true, changed: true }]);
  assert.notEqual(out.program.current.revision, p.origin.revision);
});
