import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileTix, cudaSource, optimizeTix } from '../../dist/tensor/index.js';
import { fusionPlan } from '../../dist/tensor/fusion.js';

const kernels = source => (source.match(/__global__ void/g) ?? []).length;
const planOf = source => fusionPlan(compileTix(source).current.value.functions[0]);
const load = name =>
  compileTix(readFileSync(new URL('../../corpus/tensor/' + name + '/main.tix', import.meta.url), 'utf8'));

test('the planner groups each corpus program as the stage 3 design predicts', () => {
  const expected = {
    matmul: [['single', 0]],
    softmax: [['row', 0, 3]],
    layernorm: [['row', 0, 3]],
    attention: [['row', 0, 5]],
    mlp: [['row', 0, 2]],
    conv2d: [['single', 0]],
  };
  for (const [name, segments] of Object.entries(expected)) {
    const program = load(name);
    const plan = fusionPlan(program.current.value.functions[0]);
    assert.deepEqual(
      plan.segments.map(s => [s.kind, ...(s.kind === 'single' ? [s.index] : [s.start, s.end])]),
      segments,
      name,
    );
    assert.deepEqual(plan.refusals, [], name);
    assert.equal(kernels(cudaSource(program, name)), segments.length, name);
  }
  assert.equal(kernels(cudaSource(load('softmax'), 'softmax')), 1);
  assert.equal(kernels(cudaSource(load('softmax'), 'softmax', { fuse: false })), 4);
  assert.equal(kernels(cudaSource(load('attention'), 'attention')), 1);
});

test('a cross-row read of a group tensor refuses the fusion', () => {
  const plan = planOf('fn f(x:f32[N]):f32[N]{t[i]=x[i]*2;s[i]=(sum(c)t[c])+x[i];return s;}');
  assert.deepEqual(
    plan.segments.map(s => s.kind),
    ['single', 'single'],
  );
  assert.deepEqual(plan.refusals, [{ statement: 1, reason: 't is read outside its row within the group' }]);
  assert.equal(
    kernels(
      cudaSource(compileTix('fn f(x:f32[N]):f32[N]{t[i]=x[i]*2;s[i]=(sum(c)t[c])+x[i];return s;}'), 'f'),
    ),
    2,
  );
});

test('a shifted row address refuses the fusion', () => {
  const plan = planOf(
    'fn f(x:f32[N,K],z:f32[M,1]):f32[M,K]{p[i,j]:f32[M,K]=x[i+1,j];y[i,j]=p[i,j]*2;return y;}',
  );
  assert.deepEqual(
    plan.segments.map(s => s.kind),
    ['single', 'single'],
  );
  assert.equal(plan.refusals.length, 1);
  assert.equal(plan.refusals[0].statement, 0);
  assert.match(plan.refusals[0].reason, /involves the row binder beyond a plain leading index/);
});

test('a statement whose row extent differs stays out of the group', () => {
  // w's row axis has extent K; the row statements around it have extent N, so w breaks the group twice.
  const plan = planOf(
    'fn f(x:f32[N,K],u:f32[K]):f32[N,K]{p[i,j]=x[i,j]*2;w[j]=u[j]*3;y[i,j]=p[i,j]+w[j];return y;}',
  );
  assert.deepEqual(
    plan.segments.map(s => [s.kind, ...(s.kind === 'single' ? [s.index] : [s.start, s.end])]),
    [
      ['single', 0],
      ['single', 1],
      ['single', 2],
    ],
  );
  assert.deepEqual(
    plan.refusals.map(r => r.statement),
    [1, 2],
  );
  assert.ok(plan.refusals.every(r => /not the leading axis/.test(r.reason)));
});

test('an elementwise chain fuses with register forwarding, without staging or sync', () => {
  const program = compileTix('fn f(x:f32[N]):f32[N]{a[i]=x[i]+1;y[i]=a[i]*a[i];return y;}');
  const plan = fusionPlan(program.current.value.functions[0]);
  assert.equal(plan.segments[0].kind, 'chain');
  const source = cudaSource(program, 'f');
  assert.equal(kernels(source), 1);
  assert.match(source, /float v1 = __fmul_rn\(v0, v0\);/);
  assert.doesNotMatch(source, /__shared__|__syncthreads/);
  // The intermediate never reaches global memory; the result does.
  assert.doesNotMatch(source, /t1\[\(row\)\] =/);
  assert.match(source, /t2\[\(row\)\] = v1;/);
});

test('a two-dimensional elementwise chain uses the row mapping with staging', () => {
  const program = compileTix('fn f(x:f32[N,K]):f32[N,K]{a[i,j]=x[i,j]+1;y[i,j]=a[i,j]*2;return y;}');
  const plan = fusionPlan(program.current.value.functions[0]);
  assert.equal(plan.segments[0].kind, 'row');
  const source = cudaSource(program, 'f');
  assert.equal(kernels(source), 1);
  assert.match(source, /__shared__ float stage\[12288\];/);
  assert.match(source, /__syncthreads\(\);/);
  assert.match(source, /stage\[off0 \+ l\] = t0\[\(row\) \* \(static_cast<U>\(\(d1\)\)\) \+ l\];/);
  assert.match(
    source,
    /const bool fits = \(static_cast<U>\(\(d1\)\)\) \+ \(static_cast<U>\(\(d1\)\)\) <= 12288u;/,
  );
  // The intermediate is staged for the consumer and only reaches global memory in the fallback path.
  assert.match(source, /if \(!fits\) t1\[\(row\) \* \(static_cast<U>\(\(d1\)\)\) \+ l\] = v0;/);
  assert.match(source, /if \(fits\) stage\[off1 \+ l\] = v0;/);
  // The result is written to global memory unconditionally.
  assert.match(source, /t2\[\(row\) \* \(static_cast<U>\(\(d1\)\)\) \+ l\] = v1;/);
});

test('a row group stages row-local reads and reads row-free tensors from global memory', () => {
  const program = compileTix(
    'fn f(x:f32[N,K],b:f32[K]):f32[N,K]{p[i,j]=x[i,j]*b[j];g[i,j]=p[i,j]+1;y[i,j]=g[i,j]*3;return y;}',
  );
  const plan = fusionPlan(program.current.value.functions[0]);
  assert.deepEqual(
    plan.segments.map(s => s.kind),
    ['row'],
  );
  const source = cudaSource(program, 'f');
  assert.equal(kernels(source), 1);
  assert.match(source, /stage\[off0 \+ l\] = t0\[/);
  assert.match(source, /t1\[\(i\d+\)\]/);
});

test('a fused group still writes tensors consumed outside the group', () => {
  // a is read row-freely by the refused statement e, so the group must write a to global memory;
  // b is dead outside the kernel and only reaches global memory in the fallback path.
  const program = compileTix(
    'fn f(x:f32[N,K]):f32[N,K]{a[i,j]=x[i,j]+1;b[i]=sum(j)a[i,j];e[i,j]=sum(c)a[c,j]+x[i,j];return e;}',
  );
  const plan = fusionPlan(program.current.value.functions[0]);
  assert.deepEqual(
    plan.segments.map(s => [s.kind, ...(s.kind === 'single' ? [s.index] : [s.start, s.end])]),
    [
      ['row', 0, 1],
      ['single', 2],
    ],
  );
  assert.deepEqual(plan.refusals, [{ statement: 2, reason: 'a is read outside its row within the group' }]);
  const source = cudaSource(program, 'f');
  assert.equal(kernels(source), 2);
  assert.match(source, /t1\[\(row\) \* \(static_cast<U>\(\(d1\)\)\) \+ l\] = v0;/);
  // b is dead outside the kernel and has no internal readers: it is never written to global memory.
  assert.doesNotMatch(source, /t2\[\(row\)/);
});

test('a split reduction still fuses: the group kernel keeps the generated block and tail bounds', () => {
  const program = compileTix('fn f(x:f32[N,K]):f32[N]{e[i,j]=x[i,j]-x[i,0];y[i]=sum(j)e[i,j];return y;}');
  const { program: split } = optimizeTix(program, ['split-sum']);
  const plan = fusionPlan(split.current.value.functions[0]);
  assert.deepEqual(
    plan.segments.map(s => s.kind),
    ['row'],
  );
  const source = cudaSource(split, 'f');
  assert.equal(kernels(source), 1);
  assert.match(source, /end_i\d+ = \(d1\) \/ 4 \+ \(\(d1\) % 4 != 0\)/);
  assert.match(source, /\(\(d1\) - 4LL \* i\d+\) < 4LL/);
});
