// IRWB-054 probe 04: build a remote job directory for compute-sanitizer. Emits <out>/main.cu (the batched lowering)
// and <out>/inputs.bin (one batch of cases: tails, a full tile, single rows, an empty reduction).
// Usage: node 04-race-probe.mjs <outdir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { encodeCudaCases } from '../../../../../../dist/tensor/cuda-runtime.js';
import { selectFunction } from '../../../../../../dist/tensor/model.js';

const out = process.argv[2];
if (!out) throw Error('usage: node 04-race-probe.mjs <outdir>');
const features = compileTix(`
  fn batched(a:f32[B,M,K], b:f32[B,K,N]):f32[B,M,N] { y[z,i,j] = sum(k) a[z,i,k] * b[z,k,j]; return y; }
`);
const f = selectFunction(features.current.value, 'batched');
const random = seededRandom(20);
const tensor = shape => ({
  shape,
  data: Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, () => 2 * random() - 1),
});
// tails on both tile axes and the reduction axis, a whole tile, one row, a batch of one, an empty reduction
const shapes = [
  [3, 130, 70, 90],
  [1, 128, 8, 64],
  [2, 257, 129, 1],
  [2, 1, 33, 700],
  [3, 5, 7, 2],
  [2, 32, 0, 32],
];
const cases = shapes.map(([B, M, K, N]) => ({ a: tensor([B, M, K]), b: tensor([B, K, N]) }));
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'main.cu'), cudaSource(features, 'batched'));
writeFileSync(join(out, 'inputs.bin'), encodeCudaCases(f, cases));
process.stdout.write(JSON.stringify({ out, shapes, bytes: encodeCudaCases(f, cases).length }) + '\n');
