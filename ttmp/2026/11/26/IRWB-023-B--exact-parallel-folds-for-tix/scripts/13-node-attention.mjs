import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {compileTix,runTix} from '../../../../../../dist/tensor/index.js';
const p=compileTix(readFileSync('corpus/tensor/attention/main.tix','utf8'));
const receipt=JSON.parse(readFileSync(process.argv[2],'utf8'));
const [,a,b,c,d,n,want]=receipt.stdout.match(/^Q=(\d+) K=(\d+) D=(\d+) V=(\d+) matched=(\d+)\n([0-9a-f]{64})  -$/m);
const [Q,K,D,V]=[a,b,c,d].map(Number);
let seed=23023;
function input(rows,cols) {
  const data=Float32Array.from({length:rows*cols},()=>{
    seed^=seed<<13; seed^=seed>>>17; seed^=seed<<5;
    return (seed>>>8)/2**23-1;
  });
  return {shape:[rows,cols],data};
}
const args={q:input(Q,D),k:input(K,D),v:input(K,V)};
const t=performance.now(),r=runTix(p,'attention',args);
assert.deepEqual(r.shape,[Q,V]); assert.equal(r.data.length,+n);
const sha256=createHash('sha256').update(Buffer.from(r.data.buffer,r.data.byteOffset,r.data.byteLength)).digest('hex');
assert.equal(sha256,want);
console.log(JSON.stringify({Q,K,D,V,words:+n,sha256,ms:performance.now()-t,matched:true}));
