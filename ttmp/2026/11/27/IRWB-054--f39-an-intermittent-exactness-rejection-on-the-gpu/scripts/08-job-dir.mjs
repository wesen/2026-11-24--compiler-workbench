// IRWB-054 probe 08: a job directory for probe 07: the batched contraction lowering and one case.
// Usage: node 08-job-dir.mjs <outdir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { encodeCudaCases } from '../../../../../../dist/tensor/cuda-runtime.js';
import { selectFunction } from '../../../../../../dist/tensor/model.js';

const out = process.argv[2];
if (!out) throw Error('usage: node 08-job-dir.mjs <outdir>');
const features = compileTix(`
  fn batched(a:f32[B,M,K], b:f32[B,K,N]):f32[B,M,N] { y[z,i,j] = sum(k) a[z,i,k] * b[z,k,j]; return y; }
`);
const f = selectFunction(features.current.value, 'batched');
const random = seededRandom(20);
const tensor = shape => ({
  shape,
  data: Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, () => 2 * random() - 1),
});
const cases = [{ a: tensor([3, 130, 70]), b: tensor([3, 70, 90]) }];
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'main.cu'), cudaSource(features, 'batched'));
writeFileSync(join(out, 'inputs.bin'), encodeCudaCases(f, cases));
process.stdout.write(JSON.stringify({ out }) + '\n');
