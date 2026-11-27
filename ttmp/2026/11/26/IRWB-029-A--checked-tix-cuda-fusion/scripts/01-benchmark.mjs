// Run from the worktree root after npm run build.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { compileTix, cudaSource, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { value } from '../../../../../../dist/tensor/model.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';

const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};

for (const name of process.argv.length > 2 ? process.argv.slice(2) : Object.keys(sizes)) {
  const dims = new Map(Object.entries(sizes[name]));
  const text = await readFile(`corpus/tensor/${name}/main.tix`, 'utf8');
  const p = compileTix(text);
  const random = seededRandom(20);
  const inputs = Object.fromEntries(p.current.value.functions[0].params.map(param => {
    const shape = param.shape.map(d => value(d, dims));
    const data = Float32Array.from({ length: shape.reduce((n, d) => n * d, 1) }, () =>
      name === 'layernorm' && param.name === 'eps' ? 1e-5 : 0.2 * random() - 0.1);
    return [param.name, { shape, data }];
  }));
  const runs = [];
  for (const fuse of [false, true]) {
    const source = cudaSource(p, name, { fuse });
    const { data, shape, gpuMs } = await runTixCuda(p, name, inputs, { fuse, benchmark: true });
    const digest = createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex');
    runs.push({ fuse, kernels: [...source.matchAll(/^__global__ void /gm)].length, gpuMs, shape, digest });
  }
  assert.deepEqual(runs[0].shape, runs[1].shape);
  assert.equal(runs[0].digest, runs[1].digest);
  console.log(JSON.stringify({ name, runs }));
}
