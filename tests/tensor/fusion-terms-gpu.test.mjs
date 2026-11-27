// IRWB-030-H: staged reduction terms and the fuse gate, checked on the GB10. Needs the GPU machine
// (tools/cuda-remote.mjs); the plan and source tests are in fusion-terms.test.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { seededRandom } from '../../dist/framework/contracts/index.js';
import { checkLowering, compileTix, cudaSource, runTix, runTixCuda } from '../../dist/tensor/index.js';
import { checkCudaLowering, cudaArtifact } from '../../dist/tensor/cuda-contract.js';

const words = ({ data }) => new Uint32Array(data.buffer, data.byteOffset, data.length);
const kernels = source => (source.match(/__global__ void/g) ?? []).length;
const corpus = name =>
  compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));

// The brief's "inside" placements: the division is inside the reduction, so every term divides.
const layernormInside = compileTix(`fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]):
  f32[N,D] {
    mu[i] = sum(j) x[i,j] / D;
    centered[i,j] = x[i,j] - mu[i];
    variance[i] = sum(j) centered[i,j] * centered[i,j] / D;
    y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
    return y;
  }`);
const attentionInside = compileTix(`fn attention(q: f32[Q,D], k: f32[K,D], v: f32[K,V]): f32[Q,V] {
    score[i,j] = sum(d) q[i,d] * k[j,d] / sqrt(D);
    shift[i] = max(j) score[i,j];
    e[i,j] = exp(score[i,j] - shift[i]);
    z[i] = sum(j) e[i,j];
    out[i,c] = sum(j) e[i,j] * v[j,c] / z[i];
    return out;
  }`);
const staged = compileTix(`
  fn divide(x:f32[N,C]):f32[N,C] {
    t[i]: f32[N] = sum(j) x[i,j] / C;
    y[i,j]: f32[N,C] = t[i] + x[i,j];
    return y;
  }
  fn twice(x:f32[N,C]):f32[N,C] {
    t[i]: f32[N] = (sum(j) x[i,j] / C) + (sum(j) x[i,j] * x[i,j] / C);
    y[i,j]: f32[N,C] = t[i] + x[i,j];
    return y;
  }
  fn rooted(x:f32[N,C]):f32[N,C] {
    t[i]: f32[N] = sum(j) sqrt(x[i,j]);
    y[i,j]: f32[N,C] = t[i] * x[i,j];
    return y;
  }
  fn exponentially(x:f32[N,C]):f32[N,C] {
    t[i]: f32[N] = sum(j) exp(x[i,j]);
    y[i,j]: f32[N,C] = t[i] / C;
    return y;
  }
  fn globalvec(x:f32[N,C], v:f32[C]):f32[N,C] {
    t[i]: f32[N] = sum(j) x[i,j] * v[j];
    y[i,j]: f32[N,C] = t[i];
    return y;
  }
  fn nested(x:f32[N,C]):f32[N,C] {
    t[i]: f32[N] = sum(j) (x[i,j] - (sum(k) x[i,k] / C) / C) / C;
    y[i,j]: f32[N,C] = t[i] + x[i,j];
    return y;
  }
  fn shifted(x:f32[N,C]):f32[N-1,C] {
    t[i]: f32[N-1] = sum(j) x[i+1,j] / C;
    y[i,j]: f32[N-1,C] = t[i] + x[i+1,j];
    return y;
  }
`);

const positive = (shape, seed) => {
  const random = seededRandom(seed);
  return { shape, data: Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, () => 4 * random() + 0.5) };
};

test('GB10: the inside placements are exact, one kernel, and equal to stage 2 bit for bit', async () => {
  const cases = {
    layernorm: {
      program: layernormInside,
      inputs: () => ({
        x: { shape: [5, 7], data: Float32Array.from({ length: 35 }, (_, i) => Math.sin(i)) },
        gamma: positive([7], 1),
        beta: positive([7], 2),
        eps: { shape: [1], data: Float32Array.of(1e-5) },
      }),
    },
    attention: {
      program: attentionInside,
      inputs: () => ({
        q: { shape: [3, 4], data: Float32Array.from({ length: 12 }, (_, i) => Math.cos(i)) },
        k: positive([5, 4], 3),
        v: positive([5, 2], 4),
      }),
    },
  };
  for (const [name, { program, inputs }] of Object.entries(cases)) {
    const data = inputs();
    assert.equal(kernels(cudaSource(program, name)), 1, name);
    const fused = await runTixCuda(program, name, data);
    const unfused = await runTixCuda(program, name, data, { fuse: false });
    assert.deepEqual(words(fused), words(runTix(program, name, data)), name + ' vs the meaning');
    assert.deepEqual(words(fused), words(unfused), name + ' fused vs unfused');
    assert.deepEqual(await checkLowering(program, name), { accepted: true, relation: 'exact' });
    assert.deepEqual(await checkLowering(program, name, { fuse: false }), { accepted: true, relation: 'exact' });
  }
  // the corpus program keeps its plan: the divisions are outside the reductions
  assert.deepEqual(await checkLowering(corpus('layernorm'), 'layernorm'), { accepted: true, relation: 'exact' });
});

test('GB10: staged terms agree with the meaning for every body the price list stages', async () => {
  const shapes = [
    ['divide', { x: positive([6, 5], 11) }],
    ['twice', { x: positive([6, 5], 12) }],
    ['rooted', { x: positive([4, 9], 13) }],
    ['exponentially', { x: positive([3, 4], 14) }],
    ['globalvec', { x: positive([3, 5], 15), v: positive([5], 16) }],
    ['nested', { x: positive([3, 6], 17) }],
    ['shifted', { x: positive([5, 6], 18) }],
  ];
  for (const [name, inputs] of shapes) {
    const source = cudaSource(staged, name);
    assert.match(source, /thread 0 folds them in order/, name);
    const result = await runTixCuda(staged, name, inputs);
    assert.deepEqual(words(result), words(runTix(staged, name, inputs)), name);
    assert.deepEqual(await checkLowering(staged, name), { accepted: true, relation: 'exact' }, name);
  }
});

test('GB10: the exact check rejects staged terms that are written or folded in another order', async () => {
  const source = cudaSource(staged, 'divide');
  const kernels = [{ name: 'k0', mapping: 'block', statements: ['t', 'y'], terms: ['t#0'] }];
  const reversedTerms = source.replace(
    /terms0\[t\] = (v\d+);/,
    'terms0[((d1) - 1 - t)] = $1;',
  );
  const reversedFold = source.replace(
    /for \(U t = 0; t < \(d1\); \+\+t\) (v\d+) = __fadd_rn\((v\d+), terms0\[t\]\);/,
    'for (U t = 0; t < (d1); ++t) $1 = __fadd_rn($2, terms0[(d1) - 1 - t]);',
  );
  for (const [label, mutant] of [
    ['terms written in reverse', reversedTerms],
    ['terms folded in reverse', reversedFold],
  ]) {
    assert.notEqual(mutant, source, label);
    const verdict = await checkCudaLowering(
      staged.current,
      'divide',
      cudaArtifact('divide', mutant, kernels),
    );
    assert.equal(verdict.accepted, false, label);
    assert.match(verdict.reason, /At \[.*expected .* got/, label);
  }
});

test('GB10: a launch whose block-mode rows are shorter than a warp runs stage 2 and matches the meaning', async () => {
  const short = compileTix(
    'fn f(x:f32[N,C]):f32[N,C] { m[i] = max(j) x[i,j]; e[i,j] = exp(x[i,j] - m[i]); s[i] = sum(j) e[i,j]; y[i,j] = e[i,j] / s[i]; return y; }',
  );
  const x = { shape: [300, 8], data: Float32Array.from({ length: 2400 }, (_, i) => Math.sin(i)) };
  // the gate fires at the launch's shapes; the program itself still plans (and checks) one fused kernel
  assert.equal(kernels(cudaSource(short, 'f')), 1);
  assert.equal(kernels(cudaSource(short, 'f', { shapes: { N: 300, C: 8 } })), 4);
  const gated = await runTixCuda(short, 'f', { x });
  assert.deepEqual(words(gated), words(runTix(short, 'f', { x })));
  // and the short-row fused lowering is exact too, since that is what the contract checks
  assert.deepEqual(await checkLowering(short, 'f'), { accepted: true, relation: 'exact' });
});
