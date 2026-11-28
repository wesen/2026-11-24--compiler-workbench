import test from 'node:test';
import assert from 'node:assert/strict';
import { divide, unfold } from '../../dist/stdlib/pe/index.js';

test('binding-time congruence propagates dynamic operands through cyclic copies', () => {
  // a = b; b = a + input; constant = 1; copy = constant
  const operands = new Map([
    ['a', ['b']],
    ['b', ['a', 'input']],
    ['constant', []],
    ['copy', ['constant']],
  ]);
  const candidates = new Map([...operands.keys()].map(name => [name, 'scalar']));
  assert.deepEqual(
    divide(candidates, (name, kind, bindingOf) => operands.get(name).every(arg => bindingOf(arg) === kind)),
    new Map([
      ['constant', 'scalar'],
      ['copy', 'scalar'],
    ]),
  );
});

for (const kind of ['refuse', 'generalize', 'fall-back']) {
  test(`unfold exhausts its variant budget and handles ${kind}`, () => {
    const edges = new Map();
    const result = unfold(
      {
        project: (_point, env) => env,
        allocate: (point, env) => `${point}:${env}`,
        snapshot: env => env,
        step({ point, handle }, follow) {
          assert.equal(follow(point, '*'), handle, 'the current variant was interned before its step');
          edges.set(handle, follow(point, 'constant'));
        },
        variants: 1,
        onExhaustion: { kind, env: () => '*', target: point => `generic:${point}` },
      },
      'loop',
      '*',
    );
    if (kind === 'refuse') {
      assert.deepEqual(result, { status: 'refused' });
      assert.equal(edges.size, 0);
    } else {
      assert.deepEqual(result, { status: 'complete', entry: 'loop:*', variants: 1 });
      assert.equal(edges.get('loop:*'), kind === 'generalize' ? 'loop:*' : 'generic:loop');
    }
  });
}
