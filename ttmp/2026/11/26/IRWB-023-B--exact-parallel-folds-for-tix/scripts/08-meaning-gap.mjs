// Exercise the unmodified v6 CUDA lowering contract, executing real altered CUDA on the GB10.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileTix,cudaSource,runTix} from '../../../../../../dist/tensor/index.js';
import {createCudaLowering,cudaArtifact} from '../../../../../../dist/tensor/cuda-contract.js';
import {runCudaBatch} from '../../../../../../dist/tensor/cuda-runtime.js';
const p=compileTix(readFileSync('corpus/tensor/softmax/main.tix','utf8'));
const fn=p.current.value.functions[0], source=cudaSource(p,fn.name);
const replaceOnce=(s,a,b)=>{
  assert.equal(s.split(a).length,2); return s.replace(a,b);
};
const mutants={
  expf:replaceOnce(source,'__double2float_rn(exp(static_cast<double>(v0)))','expf(v0)'),
  omit33rd:replaceOnce(source,'v0 = __fadd_rn(v0, t2','if (i1 != 32) v0 = __fadd_rn(v0, t2'),
};
function mismatches(a,b) {
  const u=new Uint32Array(a.buffer,a.byteOffset,a.length),v=new Uint32Array(b.buffer,b.byteOffset,b.length);
  assert.equal(u.length,v.length);
  let count=0;
  for(let i=0;i<u.length;i++) count+=u[i]!==v[i];
  return count;
}
for(const [name,code] of Object.entries(mutants)) {
  let cases=0,words=0,changed=0;
  const gate=createCudaLowering('ticket023-'+name,async(s,f,inputs)=>{
    const results=await runCudaBatch(s,f,inputs);
    for(let i=0;i<inputs.length;i++) {
      const want=runTix(p,fn.name,inputs[i]).data;
      cases++; words+=want.length; changed+=mismatches(want,results[i].data);
    }
    return results;
  });
  const verdict=await gate(p.current,fn.name,cudaArtifact(fn.name,code));
  assert.equal(verdict.accepted,true);
  const probe=name==='expf'?Float32Array.from([0,-1]):new Float32Array(33);
  const input={x:{shape:[1,probe.length],data:probe}};
  const expected=runTix(p,fn.name,input).data, [gpu]=await runCudaBatch(code,fn,[input]);
  const witnessChanged=mismatches(expected,gpu.data);
  console.log(JSON.stringify({name,cases,words,changed,verdict,witnessChanged,expected:[...expected.slice(-2)],actual:[...gpu.data.slice(-2)]}));
  if (name==='omit33rd') assert.equal(witnessChanged,33);
}
