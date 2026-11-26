// Offline audit. Cross-link deployed binaries, timed runs, complete partitions and public outputs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const text=name=>readFileSync(new URL(name,import.meta.url),'utf8').trim();
const json=name=>JSON.parse(text(name));
const binary=r=>r.stdout.match(/^([0-9a-f]{64})  \.\/prog$/m)[1];
const digest=r=>r.stdout.match(/^([0-9a-f]{64})  -$/m)[1];
const profile=r=>r.stdout.split('\n').find(l=>l.startsWith('NVIDIA '));
for(const [prefix,bench,oracle] of [['06','05-full.json','patched pair'],['11','11-full.json','quadratic softmax'],['13','13-full.json','quadratic attention']]) {
  const target=json(bench);
  let end=0;
  for(const interval of ['low','active','high']) {
    const host=json(prefix+'-'+interval+'-node.json'),device=json(prefix+'-'+interval+'-gpu.json');
    assert.equal(device.exit,0);
    assert.equal(binary(device),binary(target)); assert.equal(profile(device),profile(target));
    assert.equal(device.hash,target.hash); assert.equal(device.tableSha256,target.tableSha256);
    assert.equal(parseInt(host.first,16),end); end=parseInt(host.end,16);
    assert.equal(end-parseInt(host.first,16),host.words);
    assert(device.stdout.includes('audit ['+host.first+','+host.end+') words='+host.words+' '));
    assert.equal(digest(device),host.sha256); assert.equal(host.matched,true);
    assert.equal(host.sha256,json('06-'+interval+'-node.json').sha256);
  }
  assert.equal(end,0x7f800001);
  console.log(oracle+': covered '+end+' magnitude words, executable '+binary(target));
}
for(const [prefix,cases,ext] of [['11',['full','wide','tail','edges'],'jsonl'],['13',['full','small'],'json']]) {
  const target=json(prefix+'-full.json');
  let calls=0,words=0;
  for(const name of cases) {
    const r=json(prefix+'-'+name+'.json');
    assert.equal(r.exit,0); assert.equal(binary(r),binary(target));
    const hashes=Array.from(r.stdout.matchAll(/^([0-9a-f]{64})  -$/gm),m=>m[1]);
    const rows=text(prefix+'-'+name+'-node.'+ext).split('\n').map(JSON.parse);
    assert.equal(rows.length,hashes.length);
    for(const [i,e] of rows.entries()) { assert.equal(e.sha256,hashes[i]); assert.equal(e.matched,true); calls++; words+=e.words; }
  }
  console.log(prefix+': '+calls+' public-evaluator calls, '+words+' output words');
}
