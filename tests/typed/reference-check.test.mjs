import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('reference check selects projects and rejects unknown ids', () => {
  const selected = spawnSync(process.execPath, ['tools/reference-check.mjs', 'blend'], { encoding: 'utf8' });
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(JSON.parse(selected.stdout.split('\n')[0]).functions, 1);
  const unknown = spawnSync(process.execPath, ['tools/reference-check.mjs', 'no-such-project'], { encoding: 'utf8' });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /no-such-project/);
});
