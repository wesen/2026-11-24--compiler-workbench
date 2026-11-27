// Used by 02-measure.mjs --split after the first speed pipeline.
import assert from 'node:assert/strict';
export async function splitRanges(p) {
  const step = await p.apply('split-local-ranges');
  assert.equal(step.check, '40/40');
  // Each changed subst removes at least one defining set. The number of sets bounds this loop.
  let substitutions = 0;
  for (;;) {
    const r = await p.apply('subst');
    if (!r.changed) return substitutions;
    assert.equal(r.check, '40/40');
    substitutions++;
  }
}
