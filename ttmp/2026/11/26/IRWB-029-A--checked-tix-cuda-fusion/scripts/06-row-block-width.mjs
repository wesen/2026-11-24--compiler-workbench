// Compare warp occupancy tradeoffs for serial row folds and cooperative loads on the GB10.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';

const shape = [4096, 1024];
for (const name of ['softmax', 'layernorm', 'attention']) {
  const p = compileTix(await readFile(`corpus/tensor/${name}/main.tix`, 'utf8'));
  const f = p.current.value.functions[0];
  const random = seededRandom(20);
  const input = shape => ({
    shape,
    data: Float32Array.from({ length: shape.reduce((n, d) => n * d, 1) }, () => 0.2 * random() - 0.1),
  });
  const inputs = name === 'attention'
    ? { q: input([1024, 64]), k: input([1024, 64]), v: input([1024, 64]) }
    : { x: input(shape) };
  if (name === 'layernorm') {
    inputs.gamma = input([1024]);
    inputs.beta = input([1024]);
    inputs.eps = { shape: [1], data: Float32Array.of(1e-5) };
  }
  const source = cudaSource(p, name);
  let baseline;
  for (const threads of [256, 128, 64]) {
    const variant = source.replace(/, (?:256|128|64), (k\d+_fits)/, `, ${threads}, $1`);
    const [out] = await runCudaBatch(variant, f, [inputs], { benchmark: true });
    const digest = createHash('sha256').update(Buffer.from(out.data.buffer)).digest('hex');
    baseline ??= digest;
    assert.equal(digest, baseline);
    console.log(JSON.stringify({ name, threads, gpuMs: out.gpuMs, digest }));
  }
}
