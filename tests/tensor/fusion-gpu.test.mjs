// IRWB-029-D: fused lowerings checked on the GB10. Needs the GPU machine (tools/cuda-remote.mjs).
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
import { planFusion } from '../../dist/tensor/fusion.js';

const words = ({ data }) => new Uint32Array(data.buffer, data.byteOffset, data.length);
const kernels = source => (source.match(/__global__ void/g) ?? []).length;

const features = compileTix(`
  fn stencil(x:f32[N,C,H,W]):f32[N,C,H-2,W-2] {
    a[n,c,y,w] = x[n,c,y,w] * 2;
    b[n,c,y,w]: f32[N,C,H-2,W-2] = a[n,c,y+1,w+1] + a[n,c,y+2,w+2] - a[n,c,y+0,w+0];
    return b;
  }
  fn rows3(x:f32[A,B,C]):f32[A,B,C] {
    m[a,b] = max(c) x[a,b,c];
    e[a,b,c] = exp(x[a,b,c] - m[a,b]);
    s[a,b] = sum(c) e[a,b,c];
    y[a,b,c] = e[a,b,c] / s[a,b];
    return y;
  }
  fn shadow(x:f32[N,C], z:f32[N,C]):f32[N,C] {
    s[i] = sum(j) (x[i,j] * sum(j) z[i,j]);
    y[i,j] = x[i,j] / s[i] + max(s[i], z[i,j]);
    return y;
  }
  fn reused(x:f32[N,N]):f32[N,N] {
    m[i] = max(j) x[i,j]; e[i,j] = x[i,j] - m[i]; t[i] = m[i] * 2; y[i,j] = e[j,i] + t[i];
    return y;
  }
  fn shifted(x:f32[N,C]):f32[N,C-1] {
    e[i,j] = x[i,j] * 2;
    y[i,j]: f32[N,C-1] = e[i,j+1] - e[i,j+0] + min(x[i,j+1], 0);
    return y;
  }
  fn chain(a:f32[M,K], b:f32[K,N], c:f32[N]):f32[M,N] {
    y[i,j] = sum(k) a[i,k] * b[k,j];
    z[i,j] = 0.5 * y[i,j] * (1 + tanh(y[i,j] + c[j]));
    return z;
  }
  fn middle(x:f32[N,C]):f32[N] {
    m[i] = max(j) x[i,j];
    e[i,j] = x[i,j] - m[i];
    return m;
  }
  fn dead(x:f32[N,C]):f32[N,C] {
    a[i,j] = x[i,j] * 2; b[i,j] = a[i,j] + 1;
    return x;
  }
  fn affine(x:f32[N,C]):f32[N-1,C] {
    m[i]: f32[N-1] = max(j) x[i+1,j];
    y[i,j]: f32[N-1,C] = x[i+1,j] - m[i];
    return y;
  }
`);

test('GB10: fused lowerings of block domains, stencils, shadowing, reuse and epilogues are exact', async () => {
  const expected = {
    stencil: [['block', 2, 'a,b']],
    rows3: [['block', 2, 'm,e,s,y']],
    shadow: [['block', 1, 's,y']],
    reused: [
      ['block', 1, 'm,e,t'],
      ['thread', 2, 'y'],
    ],
    shifted: [['block', 1, 'e,y']],
    chain: [['thread', 2, 'y,z']],
    middle: [['block', 1, 'm,e']],
    dead: [['thread', 2, 'a,b']],
    affine: [['block', 1, 'm,y']],
  };
  for (const [name, groups] of Object.entries(expected)) {
    const plan = planFusion(features.current.value.functions.find(f => f.name === name));
    assert.deepEqual(
      plan.groups.map(g => [g.mapping, g.depth, g.statements.join(',')]),
      groups,
      name,
    );
    const verdict = await checkLowering(features, name);
    assert.deepEqual(verdict, { accepted: true, relation: 'exact' }, name + ': ' + verdict.reason);
  }
});

test('GB10: fusion after inline and split-sum keeps the generated bounds and the half-ulp witness', async () => {
  const p = compileTix(
    'fn f(x:f32[N,K]):f32[N,K] { s[i] = sum(k) x[i,k]; y[i,k] = x[i,k] - s[i]; return y; }',
  );
  const { program } = optimizeTix(p, ['split-sum']);
  assert.equal(kernels(cudaSource(program, 'f')), 1);
  const x = {
    shape: [2, 7],
    data: Float32Array.from({ length: 14 }, (_, i) => [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24][i % 7]),
  };
  const result = await runTixCuda(program, 'f', { x });
  assert.deepEqual(words(result), words(runTix(program, 'f', { x })));
  assert.equal(runTix(program, 'f', { x }).data[0], 1 - (1 + 2 ** -22));
  assert.deepEqual(await checkLowering(program, 'f'), { accepted: true, relation: 'exact' });
});

test('GB10: rows beyond the default and the opt-in shared-memory limit run through the same kernel', async () => {
  const p = compileTix(
    'fn f(x:f32[N,C]):f32[N,C] { m[i] = max(j) x[i,j]; e[i,j] = exp(x[i,j] - m[i]); s[i] = sum(j) e[i,j]; y[i,j] = e[i,j] / s[i]; return y; }',
  );
  const random = seededRandom(29);
  // 2 * 8000 floats per row is 64 000 bytes (opt-in); 2 * 30 000 is 240 000 bytes (scratch in global memory)
  for (const c of [8000, 30000]) {
    const x = { shape: [3, c], data: Float32Array.from({ length: 3 * c }, () => 8 * random() - 4) };
    const result = await runTixCuda(p, 'f', { x });
    assert.deepEqual(words(result), words(runTix(p, 'f', { x })), 'C = ' + c);
  }
});

test('GB10: the exact check rejects a fused kernel that reverses a serial sum or reads another row', async () => {
  const p = compileTix(
    'fn f(x:f32[N,C]):f32[N,C] { s[i] = sum(j) x[i,j]; y[i,j] = x[i,j] - s[i]; return y; }',
  );
  const source = cudaSource(p, 'f');
  const kernels = [{ name: 'k0', mapping: 'block', statements: ['s', 'y'] }];
  const reversed = source.replace(
    /__fadd_rn\((v\d+), r0\[\((i\d+)\)\]\)/,
    '__fadd_rn($1, r0[(end_$2 - 1 - $2)])',
  );
  const otherRow = source.replace('r0[e] = t0[point * n0 + e];', 'r0[e] = t0[e];');
  for (const mutant of [reversed, otherRow]) {
    assert.notEqual(mutant, source);
    const verdict = await checkCudaLowering(p.current, 'f', cudaArtifact('f', mutant, kernels));
    assert.equal(verdict.accepted, false);
    assert.match(verdict.reason, /At \[.*\], expected .* got/);
  }
  assert.deepEqual(await checkLowering(p, 'f'), { accepted: true, relation: 'exact' });
});

test('GB10: benchmark mode times warm launches and returns the same words', async () => {
  const p = compileTix(
    'fn f(x:f32[N,C]):f32[N,C] { m[i] = max(j) x[i,j]; y[i,j] = x[i,j] - m[i]; return y; }',
  );
  const x = { shape: [4, 33], data: Float32Array.from({ length: 132 }, (_, i) => Math.sin(i)) };
  const timed = await runTixCuda(p, 'f', { x }, { benchmark: true });
  const plain = await runTixCuda(p, 'f', { x }, { fuse: false });
  assert.deepEqual(words(timed), words(plain));
  assert.ok(Number.isFinite(timed.gpuMs) && timed.gpuMs > 0);
});

const inside = compileTix(`fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
  mean[i] = sum(j) x[i,j] / D;
  variance[i] = sum(j) (x[i,j] - mean[i]) * (x[i,j] - mean[i]) / D;
  y[i,j] = (x[i,j] - mean[i]) / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
  return y;
}`);

test('GB10: staged term phases fold in the meaning order; a reversed fold is rejected', async () => {
  const plan = planFusion(inside.current.value.functions[0]);
  assert.deepEqual(
    plan.groups[0].terms.map(t => t.statement),
    ['mean', 'variance'],
  );
  const random = seededRandom(31);
  const inputs = {
    x: { shape: [3, 17], data: Float32Array.from({ length: 51 }, () => 2 * random() - 1) },
    gamma: { shape: [17], data: Float32Array.from({ length: 17 }, () => 2 * random() - 1) },
    beta: { shape: [17], data: Float32Array.from({ length: 17 }, () => 2 * random() - 1) },
    eps: { shape: [1], data: Float32Array.of(1e-5) },
  };
  const result = await runTixCuda(inside, 'layernorm', inputs);
  assert.deepEqual(words(result), words(runTix(inside, 'layernorm', inputs)));
  // Mutant: fold the staged terms in reverse; the sum is order-sensitive, so the check must reject it.
  const source = cudaSource(inside, 'layernorm');
  const reversed = source.replace(
    /for \(U t = 0; t < (nq\d+); \+\+t\) (v\d+) = __fadd_rn\(\2, (q\d+)\[t\]\);/,
    'for (U t = 0; t < $1; ++t) $2 = __fadd_rn($2, $3[$1 - 1 - t]);',
  );
  assert.notEqual(reversed, source);
  const kernels = [{ name: 'k0', mapping: 'block', statements: ['mean', 'variance', 'y'], terms: 2 }];
  const verdict = await checkCudaLowering(
    inside.current,
    'layernorm',
    cudaArtifact('layernorm', reversed, kernels),
  );
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /At \[.*\], expected .* got/);
  assert.deepEqual(await checkLowering(inside, 'layernorm'), { accepted: true, relation: 'exact' });
});

test('GB10: a staged max over global terms and a split-sum program keep the exact relation', async () => {
  const global = compileTix(
    'fn f(x:f32[N,C], g:f32[C]):f32[N,C] { m[i]: f32[N] = max(j) g[j] / C; y[i,j] = x[i,j] - m[i]; return y; }',
  );
  const split = compileTix('fn f(x:f32[N,C]):f32[N,C] { s[i] = sum(j) x[i,j] / C; y[i,j] = x[i,j] - s[i]; return y; }');
  const optimized = optimizeTix(split, ['split-sum']).program;
  // The split bounds make the term space ragged: the plan refuses to stage and keeps the inline fold.
  assert.deepEqual(planFusion(optimized.current.value.functions[0]).groups[0].terms, []);
  const random = seededRandom(32);
  const x = { shape: [5, 33], data: Float32Array.from({ length: 165 }, () => 2 * random() - 1) };
  const g = { shape: [33], data: Float32Array.from({ length: 33 }, () => random()) };
  assert.deepEqual(words(await runTixCuda(global, 'f', { x, g })), words(runTix(global, 'f', { x, g })));
  assert.deepEqual(words(await runTixCuda(optimized, 'f', { x })), words(runTix(optimized, 'f', { x })));
  assert.deepEqual(await checkLowering(global, 'f'), { accepted: true, relation: 'exact' });
});

test('GB10: with tiny shape values at launch the fuse gate keeps the program unfused, still exact', async () => {
  const softmax = compileTix(
    'fn f(x:f32[N,C]):f32[N,C] { m[i] = max(j) x[i,j]; e[i,j] = exp(x[i,j] - m[i]); s[i] = sum(j) e[i,j]; y[i,j] = e[i,j] / s[i]; return y; }',
  );
  // 4 rows cannot fill the machine with one block per row; the launch-time gate plans stage 2's kernels.
  const fn = softmax.current.value.functions[0];
  const gated = planFusion(fn, new Map([['N', 4], ['C', 64]]));
  assert.equal(gated.unfused.length, 1);
  const random = seededRandom(33);
  const x = { shape: [4, 64], data: Float32Array.from({ length: 256 }, () => 2 * random() - 1) };
  const fused = await runTixCuda(softmax, 'f', { x });
  const unfused = await runTixCuda(softmax, 'f', { x }, { fuse: false });
  assert.deepEqual(words(fused), words(unfused));
  assert.deepEqual(words(fused), words(runTix(softmax, 'f', { x })));
});
