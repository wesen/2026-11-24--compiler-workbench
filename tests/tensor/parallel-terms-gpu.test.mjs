// IRWB-030-J: staged reduction terms and declined groups, checked on the GB10. Needs the GPU machine
// (tools/cuda-remote.mjs). The no-GPU decisions are in parallel-terms.test.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { seededRandom } from '../../dist/framework/contracts/index.js';
import { checkLowering, compileTix, cudaSource, optimizeTix, runTix, runTixCuda } from '../../dist/tensor/index.js';
import { checkCudaLowering, cudaArtifact } from '../../dist/tensor/cuda-contract.js';
import { planFusion } from '../../dist/tensor/fusion.js';
import { caseShapeValues } from '../../dist/tensor/cuda-runtime.js';
import { value } from '../../dist/tensor/model.js';

const words = ({ data }) => new Uint32Array(data.buffer, data.byteOffset, data.length);
const fnOf = (source, name) => compileTix(source).current.value.functions.find(f => f.name === name);
function inputsOf(fn, dims, seed) {
  const shapes = new Map(Object.entries(dims));
  const random = seededRandom(seed);
  return Object.fromEntries(
    fn.params.map(p => [
      p.name,
      {
        shape: p.shape.map(a => value(a, shapes)),
        data: Float32Array.from(
          { length: p.shape.reduce((n, a) => n * value(a, shapes), 1) },
          () => 0.2 * random() - 0.1,
        ),
      },
    ]),
  );
}

const insideLayernorm = `fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
  mean[i] = sum(d) x[i,d] / D;
  centered[i,j] = x[i,j] - mean[i];
  variance[i] = sum(j) centered[i,j] * centered[i,j] / D;
  y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
  return y;
}`;
const insideAttention = `fn attention(q: f32[Q,D], k: f32[K,D], v: f32[K,V]): f32[Q,V] {
  score[i,j] = sum(d) q[i,d] * k[j,d] / sqrt(D);
  shift[i] = max(j) score[i,j];
  e[i,j] = exp(score[i,j] - shift[i]);
  z[i] = sum(j) e[i,j];
  o[i,c] = sum(j) e[i,j] * v[j,c] / z[i];
  return o;
}`;
const softmax = `fn softmax(x: f32[N,C]): f32[N,C] {
  m[i] = max(j) x[i,j];
  e[i,j] = exp(x[i,j] - m[i]);
  s[i] = sum(j) e[i,j];
  y[i,j] = e[i,j] / s[i];
  return y;
}`;
// the terms double exactly, so only the fold order can change the result on the half-ulp stream
const stagedSum = `fn f(x: f32[N,C]): f32[N,C] {
  s[i] = sum(j) x[i,j] * 2;
  y[i,j] = x[i,j] - s[i];
  return y;
}`;
const stagedMaxNested = `fn f(x: f32[N,C], w: f32[C]): f32[N] {
  t[i] = max(j) (x[i,j] * 2 + sum(k) w[k]);
  z[i,j] = x[i,j] - t[i];
  y[i] = t[i] - 1;
  return y;
}`;

test('GB10: the inside placements are exact at full size and through the contract', async () => {
  for (const [name, source, dims] of [
    ['layernorm', insideLayernorm, { N: 4096, D: 1024 }],
    ['attention', insideAttention, { Q: 1024, K: 1024, D: 64, V: 64 }],
  ]) {
    const program = compileTix(source);
    const fn = program.current.value.functions[0];
    const inputs = inputsOf(fn, dims, 20);
    inputs.eps = { shape: [1], data: Float32Array.of(1e-5) };
    const fused = await runTixCuda(program, name, inputs);
    const unfused = await runTixCuda(program, name, inputs, { fuse: false });
    assert.deepEqual(words(fused), words(unfused), name);
    assert.deepEqual(words(fused), words(runTix(program, name, inputs)), name);
    assert.deepEqual(await checkLowering(program, name), { accepted: true, relation: 'exact' }, name);
    assert.deepEqual(await checkLowering(program, name, { fuse: false }), {
      accepted: true,
      relation: 'exact',
    });
  }
});

test('GB10: a staged sum keeps the half-ulp fold order and the empty extents', async () => {
  const program = compileTix(stagedSum);
  const fn = program.current.value.functions[0];
  assert.equal(planFusion(fn).groups[0].terms.length, 1);
  const x = {
    shape: [2, 7],
    data: Float32Array.from({ length: 14 }, (_, i) => [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24][i % 7]),
  };
  const meaning = runTix(program, 'f', { x });
  assert.equal(meaning.data[0], -1); // the forward fold of [1,0,0,0,3 half-ulp terms] keeps s at 2
  const result = await runTixCuda(program, 'f', { x });
  assert.deepEqual(words(result), words(meaning));
  for (const dims of [{ N: 4, C: 0 }, { N: 0, C: 1024 }, { N: 1, C: 1 }, { N: 3, C: 5 }]) {
    const inputs = inputsOf(fn, dims, 7);
    const got = await runTixCuda(program, 'f', inputs);
    assert.deepEqual(words(got), words(runTix(program, 'f', inputs)), JSON.stringify(dims));
  }
  assert.deepEqual(await checkLowering(program, 'f'), { accepted: true, relation: 'exact' });
});

test('GB10: a staged max with a nested sum in its body, and split-sum refusing the staging', async () => {
  const program = compileTix(stagedMaxNested);
  const fn = program.current.value.functions[0];
  assert.deepEqual(planFusion(fn).groups[0].terms.map(t => t.member), ['t']);
  const inputs = inputsOf(fn, { N: 64, C: 37 }, 29);
  assert.deepEqual(words(await runTixCuda(program, 'f', inputs)), words(runTix(program, 'f', inputs)));
  const optimized = optimizeTix(program, ['split-sum']).program;
  const splitPlan = planFusion(optimized.current.value.functions[0]);
  // split-sum rewrote the inner sum with generated bounds; the staged max is untouched and still staged
  assert.deepEqual(splitPlan.groups[0].terms.map(t => t.member), ['t']);
  assert.ok(splitPlan.groups[0].termRefusals.some(r => /not rectangular/.test(r.reason)));
  assert.deepEqual(await checkLowering(optimized, 'f'), { accepted: true, relation: 'exact' });
  const x2 = inputsOf(optimized.current.value.functions[0], { N: 2, C: 7 }, 11);
  assert.deepEqual(
    words(await runTixCuda(optimized, 'f', x2)),
    words(runTix(optimized, 'f', x2)),
  );
});

test('GB10: declined groups at few points run stage 2 and stay exact, including mixed plans', async () => {
  // rows-only groups are never declined (measured faster fused down to 1 point), so softmax stays fused and exact
  const program = compileTix(softmax);
  const fn = program.current.value.functions[0];
  for (const dims of [{ N: 4, C: 1024 }, { N: 64, C: 4096 }, { N: 4096, C: 1024 }]) {
    const inputs = inputsOf(fn, dims, 13);
    assert.equal(
      planFusion(fn, caseShapeValues(fn, inputs)).declined.length,
      0,
      JSON.stringify(dims),
    );
    const got = await runTixCuda(program, 'softmax', inputs);
    assert.deepEqual(words(got), words(runTix(program, 'softmax', inputs)), JSON.stringify(dims));
  }
  // a contraction program at few points is declined and runs stage 2's kernels
  const mlpProgram = compileTix(readFileSync('corpus/tensor/mlp/main.tix', 'utf8'));
  const mlpFn = mlpProgram.current.value.functions[0];
  const mlpDims = { N: 4, D: 8, H: 128, O: 8 };
  const mlpInputs = inputsOf(mlpFn, mlpDims, 19);
  assert.equal(planFusion(mlpFn, caseShapeValues(mlpFn, mlpInputs)).declined.length, 1);
  assert.deepEqual(
    words(await runTixCuda(mlpProgram, 'mlp', mlpInputs)),
    words(runTix(mlpProgram, 'mlp', mlpInputs)),
  );
  // a fused group followed by a declined one: the declined kernels read the fused group's stored member
  const mixed = `fn f(x: f32[N,C], w: f32[N-1,C], u: f32[C,C]): f32[N-1] {
    m[i] = max(j) x[i,j];
    e[i,j] = x[i,j] - m[i];
    h[i,j]: f32[N-1,C] = (sum(k) u[k,j] * w[i,k]) + e[i+1,j];
    q[i]: f32[N-1] = sum(j) h[i,j] * 2;
    return q;
  }`;
  const mixedProgram = compileTix(mixed);
  const mixedFn = mixedProgram.current.value.functions[0];
  const dims = { N: 300, C: 1024 };
  const inputs = inputsOf(mixedFn, dims, 17);
  assert.equal(planFusion(mixedFn, caseShapeValues(mixedFn, inputs)).declined.length, 1);
  assert.deepEqual(words(await runTixCuda(mixedProgram, 'f', inputs)), words(runTix(mixedProgram, 'f', inputs)));
});

test('GB10: terms beyond the shared-memory limit run through the scratch path', async () => {
  const program = compileTix(insideLayernorm);
  const fn = program.current.value.functions[0];
  for (const D of [8000, 30000]) {
    const inputs = inputsOf(fn, { N: 3, D }, 23);
    inputs.eps = { shape: [1], data: Float32Array.of(1e-5) };
    const got = await runTixCuda(program, 'layernorm', inputs);
    assert.deepEqual(words(got), words(runTix(program, 'layernorm', inputs)), 'D = ' + D);
  }
});

test('GB10: the exact check rejects a staged fold that reads the terms backwards', async () => {
  const program = compileTix(stagedSum);
  const source = cudaSource(program, 'f');
  const kernels = [{ name: 'k0', mapping: 'block', statements: ['s', 'y'] }];
  const reversed = source.replace(
    /for \(U t = 0; t < (nterm\d+); \+\+t\) (v\d+) = __fadd_rn\((v\d+), rterm\[t\]\);/,
    'for (U t = 0; t < $1; ++t) $2 = __fadd_rn($3, rterm[$1 - 1 - t]);',
  );
  assert.notEqual(reversed, source);
  const verdict = await checkCudaLowering(program.current, 'f', cudaArtifact('f', reversed, kernels));
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /At \[.*\], expected .* got/);
  assert.deepEqual(await checkLowering(program, 'f'), { accepted: true, relation: 'exact' });
});

test('GB10: benchmark mode works on a staged kernel and reports its time', async () => {
  const program = compileTix(stagedSum);
  const fn = program.current.value.functions[0];
  const inputs = inputsOf(fn, { N: 4096, C: 1024 }, 31);
  const timed = await runTixCuda(program, 'f', inputs, { benchmark: true });
  const plain = await runTixCuda(program, 'f', inputs, { fuse: false });
  assert.deepEqual(words(timed), words(plain));
  assert.ok(Number.isFinite(timed.gpuMs) && timed.gpuMs > 0);
});
