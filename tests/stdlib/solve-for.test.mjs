import test from 'node:test';
import assert from 'node:assert/strict';
import { flatLattice, intervalLattice, solveFor, BOT } from '../../dist/stdlib/index.js';

test('solveFor discovers a dependency after a controlling fact becomes known', () => {
  const visited = new Set();
  const result = solveFor(
    {
      lattice: flatLattice(),
      rhs(key, get) {
        visited.add(key);
        switch (key) {
          case 'root':
            return get('gate') === BOT ? BOT : get('cycle');
          case 'gate':
            return { value: true };
          case 'cycle':
            get('root');
            return { value: 7 };
          default:
            assert.fail(`unexpected demand: ${key}`);
        }
      },
    },
    ['root'],
    { evaluations: Infinity },
  );

  assert.equal(result.status, 'stable');
  assert.deepEqual(visited, new Set(['root', 'gate', 'cycle']));
  assert.deepEqual(
    result.values,
    new Map([
      ['root', { value: 7 }],
      ['gate', { value: true }],
      ['cycle', { value: 7 }],
    ]),
  );
});

test('solveFor revisits self-dependencies and widens only at selected unknowns', () => {
  const lattice = intervalLattice(0, 100);
  const equations = {
    lattice,
    rhs(key, get) {
      if (key === 'exit') return get('loop');
      const current = get('loop');
      return [0, current ? Math.min(lattice.top[1], current[1] + 1) : 0];
    },
  };
  // The first loop visit seeds [0, 0], the second grows it and widens, the third confirms stability.
  // The exit also runs three times, including its first demand of the loop.
  const budget = { evaluations: 6 };
  const partial = solveFor(equations, ['exit'], budget);
  assert.equal(partial.status, 'exhausted');
  assert.equal(partial.evaluations, budget.evaluations);
  const result = solveFor({ ...equations, widenAt: key => key === 'loop' }, ['exit'], budget);
  assert.equal(result.status, 'stable');
  assert.deepEqual(
    result.values,
    new Map([
      ['exit', [0, 100]],
      ['loop', [0, 100]],
    ]),
  );
});
