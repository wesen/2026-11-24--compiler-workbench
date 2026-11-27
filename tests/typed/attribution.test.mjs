import test from 'node:test';
import assert from 'node:assert/strict';
import { attributeInstructions } from '../../dist/typed/backend/attribution.js';

test('credits each executed word to its latest recorded decision through retained revisions', () => {
  const image = { insns: [{ offset: 0, covers: ['v2'] }, { offset: 4, covers: ['other'] }] };
  const revisions = [
    { pass: 'fold', correspondence: { entries: [{ from: ['v0'], to: ['v1'], relation: 'rewritten' }] } },
    { pass: 'cfg', correspondence: { entries: [{ from: ['v1'], to: ['v2'], relation: 'retained' }] } },
  ];
  assert.deepEqual([...attributeInstructions(image, Uint32Array.of(7, 3), revisions)], [
    ['fold: rewritten', 7], ['ingest/backend', 3],
  ]);
});
