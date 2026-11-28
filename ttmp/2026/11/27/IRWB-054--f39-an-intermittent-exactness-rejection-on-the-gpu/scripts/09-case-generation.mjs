// IRWB-054 probe 09: the checker's cases for `batched` are a function of the function alone — the counterexample
// cannot come from the case generator. Hashes the samples (shapes, stream, inputs, interpreter reference) three times,
// each from a fresh module state.
import { createHash } from 'node:crypto';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { cudaCases, seed } from '../../../../../../dist/tensor/contract.js';
import { selectFunction } from '../../../../../../dist/tensor/model.js';

const features = compileTix(`
  fn batched(a:f32[B,M,K], b:f32[B,K,N]):f32[B,M,N] { y[z,i,j] = sum(k) a[z,i,k] * b[z,k,j]; return y; }
`);
const digest = () => {
  const fn = selectFunction(features.current.value, 'batched');
  const samples = cudaCases(fn, seededRandom(seed));
  const h = createHash('sha256');
  for (const s of samples) {
    h.update(JSON.stringify([s.shapeValues, s.stream]));
    for (const t of Object.values(s.inputs))
      h.update(JSON.stringify([t.shape])).update(new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength));
    h.update(new Uint8Array(s.reference.data.buffer, s.reference.data.byteOffset, s.reference.data.byteLength));
  }
  return {
    cases: samples.length,
    hash: h.digest('hex').slice(0, 16),
    streams: [...new Set(samples.map(s => s.stream))],
    shapeValues: [...new Set(samples.map(s => JSON.stringify(s.shapeValues)))],
  };
};
const runs = [digest(), digest(), digest()];
process.stdout.write(
  JSON.stringify({ runs, identical: new Set(runs.map(r => r.hash)).size === 1 }, null, 2) + '\n',
);
