// Isolate the effect of the exact max instruction and sequential loop unrolling in softmax.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { checkCudaLowering, cudaArtifact } from '../../../../../../dist/tensor/cuda-contract.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';

const p = compileTix(await readFile('corpus/tensor/softmax/main.tix', 'utf8'));
const f = p.current.value.functions[0];
const random = seededRandom(20);
const shape = [4096, 1024];
const data = Float32Array.from({ length: shape[0] * shape[1] }, () => 0.2 * random() - 0.1);
const source = cudaSource(p, f.name);
const fallbackMax = source.replace(/ = row_max\(([^;]+)\);/g, ' = minmax($1, true);');
const nativeMax = fallbackMax.replace(
  /(v\d+) = minmax\(\1, ([^;]+), true\);/,
  'asm("max.NaN.f32 %0, %0, %1;" : "+f"($1) : "f"($2));',
);
assert.notEqual(fallbackMax, nativeMax);
const variants = [
  ['helper', fallbackMax],
  ['instruction', nativeMax],
  ['instruction plus unroll', nativeMax.replace(/^( +)(for \(I i\d+ = 0;)/gm, '$1#pragma unroll 4\n$1$2')],
];
let baseline;
for (const [name, variant] of variants) {
  const verdict = await checkCudaLowering(p.current, f.name, cudaArtifact(f.name, variant));
  assert.deepEqual(verdict, { accepted: true, relation: 'exact' }, name);
  const [out] = await runCudaBatch(variant, f, [{ x: { shape, data } }], { benchmark: true });
  const digest = createHash('sha256').update(Buffer.from(out.data.buffer)).digest('hex');
  baseline ??= digest;
  assert.equal(digest, baseline);
  console.log(JSON.stringify({ name, gpuMs: out.gpuMs, digest }));
}
