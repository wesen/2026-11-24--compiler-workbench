// Convert the two benchmark runs into the report's table. Run after both finish.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectIds } from '../../../../../../tools/corpus.mjs';

const read = name => readFileSync(new URL('../analysis/corpus-' + name + '.jsonl', import.meta.url),'utf8')
  .trim().split('\n').map(line => JSON.parse(line));
const before = read('before'), after = read('after');
for (const run of [before,after]) assert.deepEqual(run.map(row=>row.id),projectIds());
const sums = [0,0,0,0,0], others = [...sums];
let cases = 0, missing = 0;
console.log('| Project | r0 | O2 before | O2 after | speed before | speed after |');
console.log('|---|---:|---:|---:|---:|---:|');
for (const [i,a] of before.entries()) {
  const b = after[i];
  assert.deepEqual(b.O0, a.O0);
  assert.equal(b.cases,a.cases);
  cases += a.cases;
  missing += a.O0.unavailable;
  for (const name of ['O2','speed']) {
    assert.equal(a[name].unavailable,a.O0.unavailable);
    assert.equal(b[name].unavailable,a.O0.unavailable);
    assert.deepEqual(a[name].rejected,[]);
    assert.deepEqual(b[name].rejected,[]);
  }
  const values = [a.O0.sum,a.O2.sum,b.O2.sum,a.speed.sum,b.speed.sum];
  console.log('|',a.id,'|',values.join(' | '),'|');
  values.forEach((n,i)=>{
    sums[i] += n;
    if(a.id !== 'bytecode-vm') others[i] += n;
  });
}
console.log('| All projects |',sums.join(' | '),'|');
console.log('| Excluding VM |',others.join(' | '),'|');
console.log('\nObserved finite instruction counts for',cases-missing,'of',cases,'calls per column.');
