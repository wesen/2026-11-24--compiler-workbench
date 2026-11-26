// Compute the full public Tix oracle on exactly the input used by the deployment binary.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {compileTix,runTix} from '../../../../../../dist/tensor/index.js';
const program=compileTix(readFileSync('corpus/tensor/softmax/main.tix','utf8'));
const report=JSON.parse(readFileSync(process.argv[2],'utf8'));
const all=Array.from(report.stdout.matchAll(/^rows=(\d+) cols=(\d+) spread=(\d+) route=(\w+) matched=(\d+) bytes=(\d+)\n([0-9a-f]{64})  -$/gm));
assert(all.length);
for(const [,r,c,z,route,matched,bytes,want] of all) {
  const rows=+r,cols=+c,spread=+z;
  assert.equal(rows*cols,+matched); assert.equal(+bytes,4*rows*cols);
  let seed=23023;
  function word() { seed^=seed<<13; seed^=seed>>>17; seed^=seed<<5; return seed>>>0; }
  const edge=Float32Array.of(0,-0,-14.567090034484863,-(2**-149),-16.635532,-104,-87.3,
    -3.4028234663852886e38,3.4028234663852886e38,1,-1,-(2**-25));
  const x=Float32Array.from({length:rows*cols},(_,i)=>spread?((word()>>>8)/2**24-0.5)*spread:edge[(Math.floor(i/cols)+i%cols)%edge.length]);
  const before=performance.now();
  const y=runTix(program,'softmax',{x:{shape:[rows,cols],data:x}});
  assert.deepEqual(y.shape,[rows,cols]); assert.equal(y.data.byteLength,+bytes);
  const sha256=createHash('sha256').update(Buffer.from(y.data.buffer,y.data.byteOffset,y.data.byteLength)).digest('hex');
  assert.equal(sha256,want);
  console.log(JSON.stringify({rows,cols,spread,route,words:rows*cols,sha256,ms:performance.now()-before,matched:true}));
}
