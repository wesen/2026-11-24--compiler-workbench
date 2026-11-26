// Compare bytes from an independent implementation with the GPU's audit digest.
import {createHash} from 'node:crypto';
import {endianness} from 'node:os';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const [lo,hi,receipt]=process.argv.slice(2);
const first=parseInt(lo,16),end=parseInt(hi,16);
assert(first>=0 && end<=0x7f800001 && first<end && endianness()==='LE');
const block=new Float32Array(1<<18), bytes=Buffer.from(block.buffer);
const input=new Float32Array(1), bits=new Uint32Array(input.buffer);
const hash=createHash('sha256'), started=performance.now();
for(let pos=first;pos<end;) {
  const n=Math.min(block.length,end-pos);
  for(let i=0;i<n;i++) {
    bits[0]=pos+i;
    block[i]=Math.fround(Math.exp(-input[0]));
  }
  hash.update(bytes.subarray(0,4*n));
  pos+=n;
}
const sha256=hash.digest('hex');
if(receipt) {
  const report=JSON.parse(readFileSync(receipt,'utf8'));
  assert.equal(report.exit,0);
  const interval='audit ['+lo.padStart(8,'0')+','+hi.padStart(8,'0')+') words='+(end-first);
  assert(report.stdout.split('\n').some(line=>line===interval+' cubic-quartic-diff=0'||line===interval+' selected=quadratic'));
  assert.equal(report.stdout.match(/^([0-9a-f]{64})  -$/m)?.[1],sha256);
}
console.log(JSON.stringify({first:lo,end:hi,words:end-first,sha256,node:process.version,v8:process.versions.v8,ms:performance.now()-started,matched:!!receipt}));
