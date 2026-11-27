import test from 'node:test';
import assert from 'node:assert/strict';
import { intervalLattice } from '../../dist/framework/dataflow/lattices.js';

test('interval widening selects enclosing thresholds and falls back to extrema', () => {
  const lattice = intervalLattice(-100, 100);
  assert.deepEqual(lattice.widen([1, 3], [0, 8], [-5, 0, 10]), [0, 10]);
  assert.deepEqual(lattice.widen([0, 10], [-6, 11], [-5, 0, 10]), [-100, 100]);
  assert.deepEqual(lattice.widen([0, 10], [1, 9], [-5, 0, 10]), [0, 10]);
  assert.deepEqual(lattice.widen([0, 10], [-1, 11]), [-100, 100]);
});
