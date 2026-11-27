// IRWB-030-F: staged reductions and the cost gate, checked on the GB10. Needs the GPU machine
// (tools/cuda-remote.mjs). The staged path, the serial fallback chosen by shared memory, the scratch fallback and
// the gated (unfused) lowering are each exercised against the f32 interpreter.
import assert from 'node:assert/strict';
import test from 'node:test';
import { seededRandom } from '../../dist/framework/contracts/index.js';
import {
  checkLowering,
  compileTix,
  cudaSource,
  optimizeTix,
  runTix,
  runTixCuda,
} from '../../dist/tensor/index.js';
import { checkCudaLowering, cudaArtifact } from '../../dist/tensor/cuda-contract.js';
import { runCudaBatch } from '../../dist/tensor/cuda-runtime.js';
import { emitCuda } from '../../dist/tensor/cuda-source.js';
import { gatedPlan } from '../../dist/tensor/fusion.js';
import { value } from '../../dist/tensor/model.js';

const words = value => new Uint32Array(value.data.buffer, value.data.byteOffset, value.data.length);
const equal = (a, b) => {
  const wa = words(a),
    wb = words(b);
  assert.equal(wa.length, wb.length);
  for (let i = 0; i < wa.length; i++)
    assert.ok(wa[i] === wb[i] || (Number.isNaN(a.data[i]) && Number.isNaN(b.data[i])), `word ${i}`);
};
const inputs = (fn, dims, random) =>
  Object.fromEntries(
    fn.params.map(p => {
      const shape = p.shape.map(a => value(a, dims));
      const data = Float32Array.from({ length: shape.reduce((n, d) => n * d, 1) }, () => 2 * random() - 1);
      return [p.name, { shape, data }];
    }),
  );

const features = compileTix(`
  fn inside(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
    mean[i] = sum(d) x[i,d] / D;
    centered[i,j] = x[i,j] - mean[i];
    variance[i] = sum(d) centered[i,d] * centered[i,d] / D;
    y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
    return y;
  }
  fn multi(x: f32[N,A,B]): f32[N,A] { s[i] = (sum(a,b) (x[i,a,b] + 1) / 2) + (max(a) (x[i,a,0] * 3) - 1); y[i,a] = s[i] * x[i,a,0]; return y; }
  fn tworeductions(x: f32[N,C]): f32[N,C] { s[i] = (sum(j) x[i,j] * x[i,j] / C) + (max(j) (x[i,j] - 0.5) * 2); y[i,j] = x[i,j] / s[i]; return y; }
  fn readsrow(x: f32[N,C]): f32[N] { m[i] = max(j) x[i,j]; e[i,j] = exp(x[i,j] - m[i]); s[i] = sum(j) e[i,j] * m[i]; return s; }
  fn empty(x: f32[N,C]): f32[N,C] { s[i] = sum(j) x[i,j] / C; y[i,j] = x[i,j] - s[i]; return y; }
  fn attentioninside(q: f32[Q,D], k: f32[K,D], v: f32[K,V]): f32[Q,V] {
    s[i,j] = sum(d) q[i,d] * k[j,d] / sqrt(D);
    m[i] = max(j) s[i,j];
    e[i,j] = exp(s[i,j] - m[i]);
    l[i] = sum(j) e[i,j];
    o[i,c] = sum(j) e[i,j] * v[j,c] / l[i];
    return o;
  }
`);

test('GB10: staged reductions are exact against the f32 meaning, including empty extents', async () => {
  const random = seededRandom(31);
  for (const [name, dims] of [
    ['inside', { N: 9, D: 130 }],
    ['inside', { N: 1, D: 33 }],
    ['multi', { N: 5, A: 7, B: 9 }],
    ['multi', { N: 3, A: 0, B: 4 }],
    ['tworeductions', { N: 4, C: 100 }],
    ['readsrow', { N: 6, C: 65 }],
    ['empty', { N: 0, C: 8 }],
    ['empty', { N: 3, C: 0 }],
    ['attentioninside', { Q: 5, K: 33, D: 4, V: 7 }],
  ]) {
    const fn = features.current.value.functions.find(f => f.name === name);
    const tensors = inputs(fn, new Map(Object.entries(dims)), random);
    const result = await runTixCuda(features, name, tensors);
    equal(result, runTix(features, name, tensors));
  }
});

test('GB10: a split sum staged at its outer block level stays exact, as does its serial fallback', async () => {
  const p = compileTix(
    'fn f(x: f32[N,K]): f32[N,K] { s[i] = sum(k) x[i,k] * x[i,k]; y[i,k] = x[i,k] - s[i]; return y; }',
  );
  const { program } = optimizeTix(p, ['split-sum']);
  const fn = program.current.value.functions[0];
  const random = seededRandom(32);
  for (const [N, K] of [
    [4, 13],
    [1, 1],
    [2, 0],
  ]) {
    const x = {
      shape: [N, K],
      data: Float32Array.from({ length: N * K }, () => 2 * random() - 1),
    };
    const result = await runTixCuda(program, 'f', { x });
    equal(result, runTix(program, 'f', { x }));
  }
  assert.deepEqual(await checkLowering(program, 'f'), { accepted: true, relation: 'exact' });
});

test('GB10: term buffers beyond the shared limit take the serial fold; rows beyond it take scratch', async () => {
  // Rows fit (x's row of 8 floats, s of 1) but the term buffer of 60 000 floats (240 KB) does not: the host
  // launches <true, false>, the serial-fold instantiation of the same kernel.
  const terms = compileTix(
    'fn f(x: f32[N], w: f32[D], v: f32[M]): f32[N,M] { s[i] = sum(d) w[d] * x[i] / D; y[i,j] = s[i] * v[j]; return y; }',
  );
  const fn = terms.current.value.functions[0];
  let random = seededRandom(33);
  for (const D of [2000, 60000]) {
    const dims = new Map([
      ['N', 4],
      ['D', D],
      ['M', 9],
    ]);
    const tensors = inputs(fn, dims, random);
    const result = await runTixCuda(terms, 'f', tensors);
    equal(result, runTix(terms, 'f', tensors));
    // The gate would refuse these shapes (4 x 32 threads), so run the ungated fused source directly too: it is
    // the source cudaSource prints, and its staged or serial instantiation must both be exact.
    const [direct] = await runCudaBatch(cudaSource(terms, 'f'), fn, [tensors]);
    equal(direct, runTix(terms, 'f', tensors));
  }
  // Rows beyond the opt-in limit (240 KB) with a small term buffer: <false, true>, terms in shared memory.
  const rows = compileTix(
    'fn f(x: f32[N,C], w: f32[D]): f32[N,C] { s[i] = sum(d) w[d] * x[i,0] / D; y[i,j] = x[i,j] + s[i]; return y; }',
  );
  const fnRows = rows.current.value.functions[0];
  random = seededRandom(34);
  const dims = new Map([
    ['N', 3],
    ['C', 30000],
    ['D', 64],
  ]);
  const tensors = inputs(fnRows, dims, random);
  const [direct] = await runCudaBatch(cudaSource(rows, 'f'), fnRows, [tensors]);
  equal(direct, runTix(rows, 'f', tensors));
});

test('GB10: the inside placements are accepted by the exact lowering contract', async () => {
  for (const name of ['inside', 'attentioninside']) {
    assert.deepEqual(await checkLowering(features, name), { accepted: true, relation: 'exact' }, name);
  }
});

test('GB10: a gated (unfused) lowering passes the contract as a candidate, and is what runTixCuda runs', async () => {
  const fn = features.current.value.functions.find(f => f.name === 'inside');
  // Few rows of a long row: the gate refuses; runTixCuda runs stage 2's kernels and stays exact.
  const random = seededRandom(35);
  const tensors = inputs(fn, new Map([['N', 2], ['D', 1024]]), random);
  const result = await runTixCuda(features, 'inside', tensors);
  equal(result, runTix(features, 'inside', tensors));
  // The gated source itself, checked through the transformation's candidate path.
  const gate = gatedPlan(fn, new Map([['N', 2], ['D', 1024]]));
  assert.equal(gate.groups.length, 4);
  const source = emitCuda(fn, gate);
  const kernels = gate.groups.map(g => ({ name: g.kernel, mapping: g.mapping, statements: g.statements }));
  const verdict = await checkCudaLowering(
    features.current,
    'inside',
    cudaArtifact('inside', source, kernels),
  );
  assert.deepEqual(verdict, { accepted: true, relation: 'exact' });
});
