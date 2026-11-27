// IRWB-030-D: staged reduction terms checked on the GB10. Needs the GPU machine (tools/cuda-remote.mjs).
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

const words = ({ data }) => new Uint32Array(data.buffer, data.byteOffset, data.length);

const features = compileTix(`
  fn inside(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
    mean[i] = sum(j) x[i,j] / D;
    centered[i,j] = x[i,j] - mean[i];
    variance[i] = sum(j) centered[i,j] * centered[i,j] / D;
    y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
    return y;
  }
  fn two(x:f32[N,C], z:f32[N,C]):f32[N,C] {
    s[i] = (sum(j) x[i,j] / 3) + (max(j) exp(z[i,j])) - sum(j) z[i,j];
    y[i,j] = x[i,j] - s[i];
    return y;
  }
  fn multiaxis(x:f32[N,A,B]):f32[N,A,B] {
    s[i] = sum(a, b) x[i,a,b] / 7;
    y[i,a,b] = x[i,a,b] * s[i];
    return y;
  }
  fn nested(x:f32[N,C], z:f32[N,C]):f32[N,C] {
    s[i] = sum(j) (x[i,j] * sum(j) z[i,j] / 3);
    y[i,j] = x[i,j] / s[i];
    return y;
  }
  fn maxterms(x:f32[N,C]):f32[N,C] {
    e[i,j] = x[i,j] * 2;
    m[i] = max(j) e[i,j] / 3;
    y[i,j] = e[i,j] - m[i];
    return y;
  }
  fn last(x:f32[N,C]):f32[N] {
    e[i,j] = x[i,j] * 2;
    m[i] = sum(j) sqrt(e[i,j]);
    return m;
  }
`);

test('GB10: staged terms are exact: two staged reductions, two axes, nested terms, max, a last row scalar, split-sum', async () => {
  for (const name of ['inside', 'two', 'multiaxis', 'nested', 'maxterms', 'last']) {
    assert.match(cudaSource(features, name), /rterms\[e\] = /, name);
    const verdict = await checkLowering(features, name);
    assert.deepEqual(verdict, { accepted: true, relation: 'exact' }, name + ': ' + verdict.reason);
  }
  const { program } = optimizeTix(features, ['inline', 'split-sum']);
  for (const name of ['inside', 'two']) {
    const verdict = await checkLowering(program, name);
    assert.deepEqual(
      verdict,
      { accepted: true, relation: 'exact' },
      name + '+inline+split: ' + verdict.reason,
    );
  }
});

test('GB10: more terms than one chunk, and rows in global scratch, give the interpreter words', async () => {
  const random = seededRandom(30);
  // 3000 terms are three chunks of at most 1024; with 30 000 the rows (x, centered, terms) exceed shared memory
  for (const d of [3000, 30000]) {
    const inputs = {
      x: { shape: [3, d], data: Float32Array.from({ length: 3 * d }, () => 8 * random() - 4) },
      gamma: { shape: [d], data: Float32Array.from({ length: d }, () => random()) },
      beta: { shape: [d], data: Float32Array.from({ length: d }, () => random()) },
      eps: { shape: [1], data: Float32Array.of(1e-5) },
    };
    const result = await runTixCuda(features, 'inside', inputs);
    assert.deepEqual(words(result), words(runTix(features, 'inside', inputs)), 'D = ' + d);
  }
});

test('GB10: the exact check rejects a kernel that folds a chunk of terms backwards', async () => {
  const source = cudaSource(features, 'inside');
  const mutant = source.replace(
    /for \(U e = 0; e < chunk; \+\+e\) (v\d+) = __fadd_rn\((v\d+), rterms\[e\]\)/,
    'for (U e = 0; e < chunk; ++e) $1 = __fadd_rn($2, rterms[chunk - 1 - e])',
  );
  assert.notEqual(mutant, source);
  const kernels = [{ name: 'k0', mapping: 'block', statements: ['mean', 'centered', 'variance', 'y'] }];
  const verdict = await checkCudaLowering(
    features.current,
    'inside',
    cudaArtifact('inside', mutant, kernels),
  );
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /At \[.*\], expected .* got/);
});

test('GB10: a call whose rows are below the gate runs stage 2 and gives the interpreter words', async () => {
  const p = compileTix(
    'fn f(x:f32[N,C]):f32[N,C] { m[i] = max(j) x[i,j]; e[i,j] = exp(x[i,j] - m[i]); s[i] = sum(j) e[i,j]; y[i,j] = e[i,j] / s[i]; return y; }',
  );
  const random = seededRandom(31);
  for (const c of [8, 40]) {
    const x = { shape: [50, c], data: Float32Array.from({ length: 50 * c }, () => 8 * random() - 4) };
    const fused = await runTixCuda(p, 'f', { x });
    assert.deepEqual(words(fused), words(runTix(p, 'f', { x })), 'C = ' + c);
  }
});
