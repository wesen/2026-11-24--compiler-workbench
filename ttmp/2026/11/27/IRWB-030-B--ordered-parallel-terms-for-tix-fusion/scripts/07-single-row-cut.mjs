// A single-row pointwise producer followed by the divided value contraction. A single fused block
// would do the entire contraction on one SM. V and K are both 1024 as in the attention key grid.
import assert from 'node:assert/strict';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { emitCuda } from '../../../../../../dist/tensor/cuda-source.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
const program = compileTix(`fn f(x:f32[N,K], v:f32[K,V], d:f32[N]):f32[N,V] {
  a[i,k] = x[i,k] + 1;
  o[i,c] = sum(k) a[i,k] * v[k,c] / d[i];
  return o;
}`);
const fn = program.current.value.functions[0];
const proxy = structuredClone(fn);
assert.equal(proxy.statements[1].expr.body.op, '/');
proxy.statements[1].expr.body.op = '*';
const fused = emitCuda(fn, planFusion(proxy));
const selected = cudaSource(program, 'f');
assert.equal(selected, cudaSource(program, 'f', { fuse: false }));
const tensor = shape => ({ shape, data: Float32Array.from(
  { length: shape.reduce((a,b) => a*b, 1) }, (_, i) => (i % 37 + 1) / 37) });
const inputs = { x: tensor([1,1024]), v: tensor([1024,1024]), d: tensor([1]) };
for (let rep = 0; rep < 3; rep++) {
  const [a] = await runCudaBatch(fused, fn, [inputs], { benchmark: true });
  const [b] = await runCudaBatch(selected, fn, [inputs], { benchmark: true });
  assert.deepEqual(a.data, b.data);
  console.log(JSON.stringify({ rep, alwaysFuse: a.gpuMs, selected: b.gpuMs }));
}
