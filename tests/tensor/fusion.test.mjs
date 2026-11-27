import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileTix, cudaSource, optimizeTix } from '../../dist/tensor/index.js';
import { lowerCuda } from '../../dist/tensor/cuda-source.js';
import { planKernels } from '../../dist/tensor/fusion.js';

const count = source => (source.match(/__global__ void/g) ?? []).length;
const program = name =>
  compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));

test('corpus programs fuse to the planned kernel counts', () => {
  const expected = {
    matmul: { fused: 1, forms: ['single'], unfused: 1 },
    softmax: { fused: 1, forms: ['row'], unfused: 4 },
    layernorm: { fused: 1, forms: ['row'], unfused: 4 },
    attention: { fused: 2, forms: ['row', 'single'], unfused: 6 },
    mlp: { fused: 2, forms: ['flat', 'single'], unfused: 3 },
    conv2d: { fused: 1, forms: ['single'], unfused: 1 },
  };
  for (const [name, want] of Object.entries(expected)) {
    const p = program(name);
    const fn = p.current.value.functions[0];
    assert.deepEqual(
      planKernels(fn, true).map(g => g.form),
      want.forms,
      name,
    );
    assert.equal(count(cudaSource(p, name)), want.fused, name);
    assert.equal(count(cudaSource(p, name, { fuse: false })), want.unfused, name);
  }
});

test('the row plan stages row-element members and gives row reductions to thread 0', () => {
  const s = cudaSource(program('softmax'), 'softmax');
  assert.match(s, /extern __shared__ float sh\[\];/);
  assert.match(s, /__syncthreads\(\);/);
  assert.match(s, /if \(threadIdx\.x == 0\) \{/);
  // the row max folds sequentially over global x, the staged exponent sum over shared memory
  assert.match(s, /v1 = minmax\(v1, t0\[/);
  assert.match(s, /v5 = __fadd_rn\(v5, s0\[\(i6\)\]\);/);
  assert.match(s, /v7 = __fdiv_rn\(s0\[\(j\)\], c1\[0\]\);/);
  // no early return: every thread reaches every barrier
  assert.doesNotMatch(s, /if \(thread >= count\) return;/);
  const l = cudaSource(program('layernorm'), 'layernorm');
  assert.match(l, /float v7 = __fmul_rn\(s0\[\(i6\)\], s0\[\(i6\)\]\);/);
  assert.match(l, /v5 = __fadd_rn\(v5, v7\);/);
});

test('the flat plan computes the producer once per thread and stores only consumed outputs', () => {
  const p = program('mlp');
  const fn = p.current.value.functions[0];
  const [hAndG] = planKernels(fn, true);
  assert.equal(hAndG.form, 'flat');
  assert.deepEqual(
    hAndG.members.map(m => m.name),
    ['h', 'g'],
  );
  assert.deepEqual(hAndG.writes, ['g']);
  const s = cudaSource(p, 'mlp');
  // h's contraction is computed once per thread, and no h buffer exists
  assert.match(s, /float v5 = __fadd_rn\(v2, t2\[\(i0\)\]\);/);
  assert.doesNotMatch(s, /DeviceBuffer t5\(/);
});

test('fusable plans survive the stage-1 passes, including split sums inside a row group', () => {
  for (const [name, fused] of [
    ['softmax', 1],
    ['layernorm', 1],
    ['attention', 2],
    ['mlp', 2],
    ['matmul', 1],
    ['conv2d', 1],
  ]) {
    const optimized = optimizeTix(program(name), ['inline', 'split-sum']);
    assert.ok(
      optimized.steps.every(s => s.accepted),
      name,
    );
    assert.equal(count(cudaSource(optimized.program, name)), fused, name);
  }
});

test('fusion is refused where the IR cannot show order preservation', () => {
  // a transpose chain: the member load is not identity-indexed, so no plan applies
  const transpose = compileTix(
    'fn f(x:f32[N,C]):f32[C,N] { y[i,j] = x[i,j]; z[i,j] = y[j,i] * 2; return z; }',
  );
  assert.deepEqual(
    planKernels(transpose.current.value.functions[0], true).map(g => g.form),
    ['single', 'single'],
  );
  // a consumer reading another row of a fused member is refused (the offset makes the load non-local)
  const crossRow = compileTix(
    'fn f(x:f32[N,C]):f32[N,C] { a[i,j] = x[i,j]; b[i,j] = sum(dy) a[i+dy,j] * x[dy,j] + a[i,j]; return b; }',
  );
  assert.deepEqual(
    planKernels(crossRow.current.value.functions[0], true).map(g => g.form),
    ['single', 'single'],
  );
  // but the same shape of program without the cross-row read fuses as a row kernel
  const local = compileTix(
    'fn f(x:f32[N,C]):f32[N] { a[i,j] = x[i,j]; s[i] = a[i,0] + sum(j) a[i,j]; return s; }',
  );
  assert.deepEqual(
    planKernels(local.current.value.functions[0], true).map(g => g.form),
    ['row'],
  );
});

test('the CUDA artifact records the kernel plan it was emitted from', () => {
  const unit = lowerCuda(program('softmax').current.value.functions[0], true);
  assert.deepEqual(unit.kernels, [{ form: 'row', statements: ['m', 'e', 's', 'y'] }]);
  assert.deepEqual(lowerCuda(program('attention').current.value.functions[0], true).kernels, [
    { form: 'row', statements: ['score', 'shift', 'e', 'z', 'weight'] },
    { form: 'single', statements: ['out'] },
  ]);
});

test('identity chains fuse across reductions as flat epilogues; transposed consumers do not', () => {
  // contraction then pointwise epilogue with repeated identical reads
  const mlpLike = compileTix(
    'fn f(x:f32[N,D], w:f32[D,H]):f32[N,H] { h[i,j] = sum(d) x[i,d] * w[d,j]; g[i,j] = h[i,j] + h[i,j] * h[i,j]; return g; }',
  );
  const [plan] = planKernels(mlpLike.current.value.functions[0], true);
  assert.deepEqual([plan.form, plan.members.map(m => m.name)], ['flat', ['h', 'g']]);
  // a plain elementwise chain whose consumer transposes its producer stays at two kernels
  const chain = compileTix(
    'fn f(x:f32[N,C]):f32[C,N] { y[i,j] = x[i,j] + 1; z[i,j] = y[j,i] * 2; return z; }',
  );
  assert.deepEqual(
    planKernels(chain.current.value.functions[0], true).map(g => g.form),
    ['single', 'single'],
  );
});
