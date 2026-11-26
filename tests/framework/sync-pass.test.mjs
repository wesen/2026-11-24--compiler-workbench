import test from 'node:test';
import assert from 'node:assert/strict';
import { defineIR, AnalysisManager } from '../../dist/framework/contracts/index.js';
import { defineAdapter, createIRArtifact } from '../../dist/framework/ir/index.js';
import { applyPass, applyPassSync, definePass } from '../../dist/framework/passes/index.js';

const ir = defineIR({
  id: 'test.sync',
  version: '1',
  description: 'scalar',
  validate(v) {
    if (!Number.isInteger(v.n)) throw new Error('not an integer');
  },
});
const entity = v => ({ id: 'n', kind: 'number', attributes: { number: v.n } });
const definition = {
  id: 'test.sync.adapter',
  version: '1',
  kind: ir.id,
  schemaVersion: ir.version,
  description: 'number',
  validate: ir.validate,
  relationKinds: {},
  entities: v => [entity(v)],
  resolve: (v, id) => (id === 'n' ? entity(v) : undefined),
  relations: () => [],
  describe: () => ({ label: 'n' }),
};
const adapter = defineAdapter(definition);
const make = (changes = {}) =>
  definePass({
    id: 'test.sync.pass',
    version: '1',
    description: 'add one',
    ir,
    adapter,
    writes: { entities: ['number'], relations: [] },
    run: ({ before }) => ({
      native: { n: before.value.n + 1 },
      correspondence: [{ from: ['n'], to: ['n'], relation: 'add' }],
    }),
    ...changes,
  });
const start = createIRArtifact(adapter, 'start', { n: 0 });
const yes = { check: () => ({ ok: true, evidence: { compare: 'test' } }) };

test('sync native pass works without graph rebuild and prepares the same revision as the async path', async () => {
  const s = applyPassSync(make(), start, {
    check: ({ input, output }) => {
      assert.equal(input, start);
      assert.ok(Object.isFrozen(output.value));
      return yes.check();
    },
  });
  // The managed runner currently expects a Rewritable adapter even for a native pass.
  const withRebuild = defineAdapter({
    ...definition,
    rebuild() {
      throw new Error('native does not rebuild');
    },
  });
  const a = await applyPass(make({ adapter: withRebuild }), start, { manager: new AnalysisManager() });
  assert.equal(s.artifact.revision, a.artifact.revision);
  assert.deepEqual(s.changes, a.changes);
  assert.deepEqual(s.correspondence, a.correspondence);
  assert.equal(s.correspondence.entries[0].relation, 'add');
  assert.ok(Object.isFrozen(s.contract.evidence));
});

test('validation and declared writes precede the sync check; a negative check vetoes the result', () => {
  const never = { check: () => assert.fail('gate ran') };
  assert.throws(
    () => applyPassSync(make({ run: () => ({ native: { n: 0.5 } }) }), start, never),
    /not an integer/,
  );
  assert.throws(() => applyPassSync(make({ writes: { entities: [], relations: [] } }), start, never), {
    code: 'undeclaredWrite',
  });
  assert.throws(() => applyPassSync(make(), start, { check: () => ({ ok: false, reason: 'no' }) }), {
    code: 'contractRejected',
  });
  assert.equal(applyPassSync(make({ run() {} }), start, never).artifact, start);
  assert.equal(applyPassSync(make({ run: () => ({ native: { n: 0 } }) }), start, never).artifact, start);
});

test('sync does not silently skip managed clauses or accept graph edits, bogus results or promises', () => {
  for (const opt of [{ needs: { n: {} } }, { preserves: [{}] }, { contract: {} }])
    assert.throws(() => applyPassSync(make(opt), start, yes), { code: 'badResult' });
  assert.throws(
    () =>
      applyPassSync(
        make({
          run({ edit }) {
            return edit;
          },
        }),
        start,
        yes,
      ),
    { code: 'badResult' },
  );
  assert.throws(
    () =>
      applyPassSync(
        make({
          run() {
            return true;
          },
        }),
        start,
        yes,
      ),
    { code: 'badResult' },
  );
  assert.throws(
    () =>
      applyPassSync(make(), start, {
        check() {
          return true;
        },
      }),
    { code: 'badResult' },
  );
  assert.throws(
    () =>
      applyPassSync(
        make({
          run() {
            return Promise.reject(new Error('kernel'));
          },
        }),
        start,
        yes,
      ),
    { code: 'ir.async' },
  );
  assert.throws(
    () =>
      applyPassSync(make(), start, {
        check() {
          return Promise.reject(new Error('check'));
        },
      }),
    { code: 'ir.async' },
  );
});
