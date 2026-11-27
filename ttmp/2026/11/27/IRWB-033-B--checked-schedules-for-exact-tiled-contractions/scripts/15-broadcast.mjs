// Check the register-only reuse rule with a short reduction and with an affine stencil.
import { programs,inputsFor,digest } from '../../IRWB-030-E--fusion-that-is-never-slower-parallel-terms-serial-fold-and-a-cost-gate/scripts/01-benchmark.mjs';
import { compileTix,cudaSource } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
const batch='fn batch(a:f32[B,M,K],b:f32[B,K,N]):f32[B,M,N]{y[h,i,j]=sum(k)a[h,i,k]*b[h,k,j];return y;}';
for (const [name,source,sizes] of [
  ...[1,16,128].map(K=>['batch',batch,{B:8,M:128,N:128,K}]),
  ...[1,4].map(C=>['conv2d',programs.conv2d.source,{N:1,C,H:128,W:128,O:8}])
]) {
  const p=compileTix(source), fn=p.current.value.functions[0], code=cudaSource(p,name);
  const {inputs}=inputsFor(p,name,sizes);
  for(let round=0;round<5;round++) for(const gate of ['fused','unfused']) {
    const [r]=await runCudaBatch(code,fn,[inputs],{benchmark:true,gate});
    console.log(JSON.stringify({name,sizes,round,gate,ms:r.gpuMs,hash:digest(r)}));
  }
}
