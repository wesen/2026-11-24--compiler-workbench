import test from 'node:test';
import assert from 'node:assert/strict';
import { liveness } from '../../dist/stdlib/index.js';

const block = (successors, uses = [], definitions = []) => ({
  successors, uses: new Set(uses), definitions: new Set(definitions),
});

test('an unreachable predecessor of a reachable join has the join live out', () => {
  const result = liveness([block([2]), block([2]), block([], [64, 65])]);
  assert.deepEqual(result.liveOut[1], new Set([64, 65]));
});

test('liveness solves all blocks, including an unreachable predecessor and a loop', () => {
  // Block 1 has no path from entry 0; it still flows to the join, as machine liveness requires.
  const result = liveness([
    block([2]), block([2]), block([3], [64, 65]), block([2], [66], [65]),
  ]);
  assert.deepEqual(result.liveOut.map(s => [...s].sort()), [[64, 65, 66], [64, 65, 66], [64, 66], [64, 65, 66]]);
  assert.deepEqual(result.liveIn.map(s => [...s].sort()), [[64, 65, 66], [64, 65, 66], [64, 65, 66], [64, 66]]);
  assert.deepEqual(liveness([]), { liveIn: [], liveOut: [] });
});
