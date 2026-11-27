// IRWB-033-G: the tiled contraction on the GB10. Its own file, so every other tensor test runs without a GPU.
//
// The contract (`checkLowering`) checks every sample of a program with a tiled kernel on both bodies, because the
// samples are small and the launch rule would pick the per-element body for them. These tests do the same by hand
// for the shapes a tiled launch actually reaches, and compare the tiled body with the f32 interpreter.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkLowering, compileTix, cudaSource, runTix, runTixCuda } from '../../dist/tensor/index.js';
import { runCudaBatch } from '../../dist/tensor/cuda-runtime.js';
import { emitSchedule } from '../../dist/tensor/cuda-source.js';
import { scheduleStrategy } from '../../dist/tensor/schedule-strategy.js';
import { selectFunction } from '../../dist/tensor/model.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const words = data => new Uint32Array(data.buffer, data.byteOffset, data.length);
const same = (a, b) =>
  a.length === b.length &&
  words(a).every((w, i) => w === words(b)[i] || (Number.isNaN(a[i]) && Number.isNaN(b[i])));
function stream(seed = 20) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    return ((value % 2001) - 1000) * 1e-4;
  };
}
function inputs(fn, shapes) {
  const next = stream();
  return Object.fromEntries(
    fn.params.map(p => [
      p.name,
      {
        shape: shapes[p.name],
        data: Float32Array.from({ length: shapes[p.name].reduce((a, b) => a * b, 1) }, next),
      },
    ]),
  );
}

const matmul = compileTix(
  'fn mm(a: f32[M,K], b: f32[K,N]): f32[M,N] { y[i,j] = sum(k) a[i,k] * b[k,j]; return y; }',
);

test('the tiled body is exact against the f32 meaning on every shape, including non-multiples and short sums', async () => {
  const fn = selectFunction(matmul.current.value, 'mm');
  const source = emitSchedule(fn, scheduleStrategy(fn, { baseline: matmul.current }).schedule);
  for (const [m, k, n] of [
    [1, 1, 1],
    [3, 1, 4],
    [17, 3, 5],
    [40, 96, 33],
    [64, 64, 64],
    [96, 40, 70],
    [129, 65, 63],
    [2, 129, 2],
    [0, 4, 3],
    [5, 0, 7],
  ]) {
    const case_ = inputs(fn, { a: [m, k], b: [k, n] });
    const meaning = runTix(matmul, 'mm', case_);
    for (const tile of ['tiled', 'plain']) {
      const [out] = await runCudaBatch(source, fn, [case_], { tile });
      assert.ok(same(out.data, meaning.data), `${m}x${k}x${n} ${tile}`);
      assert.deepEqual(out.tiles, { k0: tile });
    }
  }
});

test('a full-size contraction launches the tiled body and matches the per-element one word for word', async () => {
  const fn = selectFunction(matmul.current.value, 'mm');
  const fused = await runTixCuda(matmul, 'mm', inputs(fn, { a: [512, 512], b: [512, 512] }));
  const plain = await runTixCuda(matmul, 'mm', inputs(fn, { a: [512, 512], b: [512, 512] }), { fuse: false });
  assert.deepEqual(fused.tiles, { k0: 'tiled' });
  assert.ok(same(fused.data, plain.data));
  assert.deepEqual(fused.shape, [512, 512]);
});

test('the other contraction forms are exact: a transposed operand, an epilogue, a shifted read', async () => {
  const programs = [
    [
      'fn f(a: f32[M,K], b: f32[N,K]): f32[M,N] { y[i,j] = sum(k) a[i,k] * b[j,k]; return y; }',
      { a: [37, 45], b: [29, 45] },
    ],
    [
      'fn f(a: f32[K,M], b: f32[K,N]): f32[M,N] { y[i,j] = sum(k) a[k,i] * b[k,j]; return y; }',
      { a: [45, 37], b: [45, 29] },
    ],
    [
      'fn f(a: f32[M,K], b: f32[K,N], c: f32[N]): f32[M,N] { y[i,j] = (sum(k) a[i,k] * b[k,j]) + c[j]; return y; }',
      { a: [40, 33], b: [33, 21], c: [21] },
    ],
  ];
  for (const [source, shapes] of programs) {
    const program = compileTix(source);
    const fn = selectFunction(program.current.value, 'f');
    const schedule = scheduleStrategy(fn, { baseline: program.current }).schedule;
    assert.ok(schedule.kernels[0].contraction, source);
    const emitted = emitSchedule(fn, schedule);
    const case_ = inputs(fn, shapes);
    const meaning = runTix(program, 'f', case_);
    for (const tile of ['tiled', 'plain']) {
      const [out] = await runCudaBatch(emitted, fn, [case_], { tile });
      assert.ok(same(out.data, meaning.data), `${source} ${tile}`);
    }
  }
});

test('a contraction form the IR refuses keeps the fusion plan’s kernel and stays exact', async () => {
  // the body multiplies three reads: not a contraction this stage tiles, so it is stage 3b's kernel
  const program = compileTix(
    'fn f(a: f32[M,K], b: f32[K,N], c: f32[N]): f32[M,N] { y[i,j] = sum(k) a[i,k] * b[k,j] * c[j]; return y; }',
  );
  const fn = selectFunction(program.current.value, 'f');
  assert.equal(
    scheduleStrategy(fn, { baseline: program.current }).schedule.kernels[0].contraction,
    undefined,
  );
  assert.ok(!cudaSource(program, 'f').includes('tile_mode'));
  const case_ = inputs(fn, { a: [11, 13], b: [13, 7], c: [7] });
  const out = await runTixCuda(program, 'f', case_);
  assert.ok(same(out.data, runTix(program, 'f', case_).data));
});

test('checkLowering accepts the corpus, fused and unfused, with both sides of every launch-time choice', async () => {
  for (const name of ['matmul', 'attention', 'mlp']) {
    for (const fuse of [true, false]) {
      const verdict = await checkLowering(corpus(name), name, { fuse });
      assert.equal(verdict.accepted, true, `${name} fuse=${fuse} ${verdict.reason ?? ''}`);
      assert.equal(verdict.relation, 'exact');
    }
  }
  for (const name of ['softmax', 'layernorm', 'conv2d']) {
    const verdict = await checkLowering(corpus(name), name);
    assert.equal(verdict.accepted, true, `${name} ${verdict.reason ?? ''}`);
  }
});

test('the whole corpus runs fused and unfused with the same words at the corpus sizes', async () => {
  const sizes = {
    matmul: { a: [64, 64], b: [64, 64] },
    softmax: { x: [8, 32] },
    attention: { q: [8, 16], k: [8, 16], v: [8, 16] },
    mlp: { x: [8, 16], w: [16, 24], bias: [24], v: [24, 12], outBias: [12] },
    conv2d: { x: [1, 2, 8, 8], kernel: [3, 2, 3, 3] },
  };
  for (const [name, shapes] of Object.entries(sizes)) {
    const program = corpus(name);
    const fn = selectFunction(program.current.value, name);
    const case_ = inputs(fn, shapes);
    const fused = await runTixCuda(program, name, case_);
    const plain = await runTixCuda(program, name, case_, { fuse: false });
    assert.ok(same(fused.data, plain.data), name);
    assert.ok(same(fused.data, runTix(program, name, case_).data), name + ' vs the meaning');
  }
  const layernorm = corpus('layernorm');
  const fn = selectFunction(layernorm.current.value, 'layernorm');
  const case_ = inputs(fn, { x: [8, 32], gamma: [32], beta: [32], eps: [1] });
  case_.eps.data[0] = 1e-5;
  const out = await runTixCuda(layernorm, 'layernorm', case_);
  assert.ok(same(out.data, runTix(layernorm, 'layernorm', case_).data));
});
