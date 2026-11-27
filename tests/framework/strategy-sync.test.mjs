import assert from 'node:assert/strict';
import test from 'node:test';
import * as S from '../../dist/framework/strategy/index.js';

const transform = (id, run) => ({ id, version: '1', kind: 'transform', description: id, run });

test('executeSync runs sequence, apply, attempt and scope with synchronous algorithms and plain arguments', () => {
  const registry = new S.AlgorithmRegistry()
    .register(transform('add', (_ctx, input, args) => input + args.n))
    .register(transform('refuse', ctx => ctx.reject('no', 'refused', { why: 1 })))
    .register(
      transform('note', (ctx, input) => {
        ctx.record('seen', input);
        return input;
      }),
    );
  const plan = S.plan(
    'p',
    S.sequence(
      'main',
      S.apply('a', S.algorithm('add'), { args: { n: 2 } }),
      S.attempt('t', S.apply('r', S.algorithm('refuse')), S.apply('b', S.algorithm('add'), { args: { n: 10 } })),
      S.scope('s', 'inner', S.apply('n', S.algorithm('note'))),
    ),
  );
  const execution = S.executeSync(plan, registry, 1);
  assert.equal(execution.status, 'succeeded');
  assert.equal(execution.result, 13);
  assert.deepEqual(
    execution.records.map(r => [r.node, r.status]),
    [
      ['a', 'succeeded'],
      ['r', 'rejected'],
      ['t', 'recovered'],
      ['b', 'succeeded'],
      ['n', 'succeeded'],
    ],
  );
  assert.deepEqual(execution.records.at(-1).evidence, [{ label: 'seen', data: 13 }]);
  // the asynchronous interpreter gives the same value for the same plan
  return S.execute(plan, registry, 1).then(full => assert.deepEqual([full.status, full.output ?? full.result ?? full.value], ['succeeded', 13]));
});

test('executeSync reports an unrecovered rejection and refuses what it does not run', () => {
  const registry = new S.AlgorithmRegistry()
    .register(transform('refuse', ctx => ctx.reject('no', 'refused')))
    .register(transform('later', async (_ctx, input) => input));
  const rejected = S.executeSync(S.plan('p', S.apply('r', S.algorithm('refuse'))), registry, 0);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.error.code, 'no');
  assert.throws(() => S.executeSync(S.plan('q', S.apply('l', S.algorithm('later'))), registry, 0), /asynchronous/);
  assert.throws(
    () => S.executeSync(S.plan('r', S.parallel('par', [S.apply('l', S.algorithm('later'))])), registry, 0),
    /does not run parallel nodes/,
  );
  assert.throws(
    () =>
      S.executeSync(S.plan('t', S.apply('l', S.algorithm('later'), { args: { x: S.ref('current') } })), registry, 0),
    /template/,
  );
});
