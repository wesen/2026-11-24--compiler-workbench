import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const rows = file => readFileSync(new URL(file, import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
const med = values => values.toSorted((x, y) => x - y)[Math.floor(values.length / 2)];
const times = rows('01-final.jsonl');
const contract = rows('03-contract.jsonl');
assert.equal(times.length, 48);
for (const label of new Set(times.map(r => r.label))) {
  const both = times.filter(r => r.label === label);
  assert.equal(new Set(both.map(r => r.digest)).size, 1, label);
  const results = [true, false].map(fuse => {
    const group = both.filter(r => r.fuse === fuse);
    assert.deepEqual(group.map(r => r.rep), [0, 1, 2]);
    assert.equal(new Set(group.map(r => r.kernels)).size, 1);
    return { kernels: group[0].kernels, ms: med(group.map(r => r.gpuMs)).toFixed(3) };
  });
  const checks = contract.filter(r => r.label === label);
  assert.equal(checks.length, 2);
  assert.ok(checks.every(r => r.accepted && r.relation === 'exact'));
  console.log(label, ...results.map(r => r.kernels), ...results.map(r => r.ms), checks[0].cases,
    ...checks.map(r => r.wallMs.toFixed(1)));
}
