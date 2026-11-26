import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {compileTix,optimizeTix} from '../../../../../../dist/tensor/index.js';
import {regions,inspectRow} from './12-row-region.mjs';
for(const name of ['attention','conv2d','layernorm','matmul','mlp','softmax']) {
  const s=readFileSync('corpus/tensor/'+name+'/main.tix','utf8'),p=compileTix(s);
  const found=regions(p.current.value.functions[0]);
  console.log(JSON.stringify({name,found}));
  assert.equal(found.length,Number(name==='attention'||name==='softmax'));
  if(name==='attention') {
    const escaping=compileTix(s.replace('weight[i,j] * v[j,c]','(weight[i,j]+e[i,j]) * v[j,c]'));
    const reason=inspectRow(escaping.current.value.functions[0],1).error;
    assert(reason.includes('escapes')); console.log(JSON.stringify({mutation:'extra downstream read',reason}));
    const split=optimizeTix(p,['split-sum']);
    assert(split.steps[0].accepted);
    assert.equal(regions(split.program.current.value.functions[0]).length,0);
    console.log('split attention has no eligible original-fold region');
  }
}
