// IRWB-054 probe 02: is the batched contraction kernel deterministic? Send the same case N times in one request
// (the remote program runs the kernel once per case), for each variant forced, and compare all N results with each
// other and with the interpreter.
// Usage: node 02-repeat-determinism.mjs [repeats=200] [variant=all]
import { createHash } from 'node:crypto';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource, runTix } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { selectFunction } from '../../../../../../dist/tensor/model.js';

const repeats = Number(process.argv[2] ?? 200);
const only = process.argv[3] === undefined ? null : Number(process.argv[3]);
const features = compileTix(`
  fn batched(a:f32[B,M,K], b:f32[B,K,N]):f32[B,M,N] { y[z,i,j] = sum(k) a[z,i,k] * b[z,k,j]; return y; }
`);
const f = selectFunction(features.current.value, 'batched');
const source = cudaSource(features, 'batched');
const random = seededRandom(20);
const [B, M, K, N] = [3, 5, 7, 2];
const tensor = shape => ({
  shape,
  data: Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, () => 2 * random() - 1),
});
const inputs = { a: tensor([B, M, K]), b: tensor([B, K, N]) };
const expected = runTix(features, 'batched', inputs);
const words = ({ data }) => new Uint32Array(data.buffer, data.byteOffset, data.length);
const sha = d => createHash('sha256').update(words(d)).digest('hex').slice(0, 16);
const modes = [0, 1, 2, 3].filter(v => only === null || v === only);
const report = { repeats, expected: sha(expected), variants: {} };
for (const variant of modes) {
  const out = await runCudaBatch(source, f, Array.from({ length: repeats }, () => inputs), { variant });
  const hashes = out.map(sha);
  const distinct = new Map();
  out.forEach((r, i) => {
    const h = hashes[i];
    if (!distinct.has(h)) distinct.set(h, { count: 0, first: i });
    distinct.get(h).count++;
  });
  const ref = words(expected);
  const mismatch = out
    .map((r, i) => ({ i, at: words(r).findIndex((w, p) => w !== ref[p]) }))
    .filter(x => x.at >= 0);
  const example = mismatch.length ? out[mismatch[0].i] : null;
  report.variants[variant] = {
    distinct: [...distinct.entries()].map(([hash, v]) => ({ hash, ...v })),
    mismatchedCases: mismatch.length,
    firstMismatch: mismatch[0] ?? null,
    detail: example
      ? mismatch.slice(0, 3).map(({ i, at }) => ({
          case: i,
          at,
          coordinate: [Math.floor(at / (M * N)), Math.floor(at / N) % M, at % N],
          expected: expected.data[at],
          got: example.data[at],
        }))
      : null,
  };
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
