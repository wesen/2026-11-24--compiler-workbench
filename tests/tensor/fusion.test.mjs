import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileTix, cudaSource, optimizeTix } from '../../dist/tensor/index.js';
import { fusePlan, loadSites, stagedIndex } from '../../dist/tensor/fusion.js';

const corpus = name =>
  compileTix(readFileSync(new URL('../../corpus/tensor/' + name + '/main.tix', import.meta.url), 'utf8'));
const kernels = source => (source.match(/__global__ void/g) ?? []).length;
const fnOf = (program, name) => program.current.value.functions.find(f => f.name === name);

// The plan prints the kernels, so its kernel count and the source's must agree; if they drift, the emitted grouping
// is not the one that was judged legal.
for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d'])
  test('the fused plan and its source agree on the kernel count for ' + name, () => {
    for (const program of [corpus(name), optimizeTix(corpus(name), ['inline', 'split-sum']).program]) {
      const fn = fnOf(program, name);
      const plan = fusePlan(fn);
      assert.equal(plan.kernels.length, kernels(cudaSource(program, name)));
      assert.equal(fn.statements.length, kernels(cudaSource(program, name, { fuse: false })));
      // Every statement is decided once, and every decided statement is in the kernel it names.
      const names = plan.decisions.map(d => d.name).sort();
      assert.deepEqual(names, [...new Set(fn.statements.map(s => s.name))].sort());
      for (const kernel of plan.kernels)
        for (const p of kernel.statements) assert.equal(p.kernel, plan.kernels.indexOf(kernel));
    }
  });

test('the corpus fuses to one kernel, and only where there is something to fuse', () => {
  const decisions = name => {
    const program = corpus(name);
    return fusePlan(fnOf(program, name)).decisions.map(d => `${d.name}:${d.storage}`);
  };
  assert.deepEqual(decisions('softmax'), ['m:shared', 'e:shared', 's:shared', 'y:global']);
  assert.deepEqual(decisions('layernorm'), ['mean:shared', 'centered:shared', 'variance:shared', 'y:global']);
  assert.deepEqual(decisions('attention'), [
    'score:shared',
    'shift:shared',
    'e:shared',
    'z:shared',
    'weight:shared',
    'out:global',
  ]);
  assert.deepEqual(decisions('mlp'), ['h:shared', 'g:shared', 'y:global']);
  assert.deepEqual(decisions('matmul'), ['y:global']);
  // A single statement has nothing to fuse, so the fused lowering is stage 2's text, byte for byte.
  for (const name of ['matmul', 'conv2d']) {
    const program = corpus(name);
    assert.equal(cudaSource(program, name), cudaSource(program, name, { fuse: false }));
    assert.equal(kernels(cudaSource(program, name)), 1);
  }
});

test('a run keeps only statements that share one row extent, and rank above two stays flat', () => {
  const plan = src => {
    const fn = compileTix(src).current.value.functions[0];
    return fusePlan(fn);
  };
  // Two reductions over the same rows, then a reader: one kernel.
  assert.equal(
    plan('fn f(x:f32[N,K],z:f32[N,L]):f32[N]{a[i]=sum(j) x[i,j];b[i]=sum(j) z[i,j];y[i]=a[i]+b[i];return y;}')
      .kernels.length,
    1,
  );
  // Two reductions cannot share a block per row when their row extents differ: a is over P rows, b over N.
  const rows = plan('fn f(x:f32[N,K], z:f32[P,M]):f32[N]{a[p]=sum(m) z[p,m];b[i]=sum(k) x[i,k];return b;}');
  assert.equal(rows.kernels.length, 2);
  assert.deepEqual(
    rows.kernels.map(k => k.statements.map(p => p.statement.name)),
    [['a'], ['b']],
  );
  // A rank three statement keeps stage 2's mapping, in its own kernel.
  const three = plan('fn f(x:f32[N,K]):f32[N,K,3]{y[i,j,k]:f32[N,K,3]=x[i,j]*3;return y;}');
  assert.equal(three.kernels.length, 1);
  assert.equal(three.kernels[0].mapping, 'flat');
});

test('a value read outside its kernel is never staged, and a staged value is read from its own row', () => {
  const program = compileTix(
    'fn f(x:f32[N,K]):f32[N,N]{s[i,j]=sum(k) x[i,k]*x[j,k];t[i,j]=s[j,i]+1;return t;}',
  );
  const fn = fnOf(program, 'f');
  const plan = fusePlan(fn);
  // t reads s at [j, i], which is not t's own row, so s has to reach global memory.
  assert.deepEqual(
    plan.decisions.map(d => `${d.name}:${d.storage}`),
    ['s:global', 't:global'],
  );
  assert.equal(plan.kernels.length, 1);
  // The staged reads the plan allows are exactly the ones the emitter can serve.
  const softmax = fusePlan(fnOf(corpus('softmax'), 'softmax'));
  const kernel = softmax.kernels[0];
  const staged = new Map(
    kernel.statements.filter(p => p.storage === 'shared').map(p => [p.statement.name, p.slots]),
  );
  for (const p of kernel.statements)
    for (const site of loadSites(p.statement))
      if (staged.has(site.tensor))
        assert.ok(stagedIndex(p.statement, site.scope, site.indices, staged.get(site.tensor)));
});

test('a fused kernel launches a block per row with the measured block size and sizes its shared memory', () => {
  const source = cudaSource(corpus('softmax'), 'softmax');
  assert.match(source, /k0<<<\(d0\), 128, \(1 \+ \(d1\) \+ 1 \+ \(d1\)\) \* sizeof\(float\)>>>/);
  assert.match(source, /cudaFuncSetAttribute\(k0, cudaFuncAttributeMaxDynamicSharedMemorySize/);
  // One barrier after the copy in and one per statement: the staged values reach the other threads and the fold.
  assert.equal((source.match(/__syncthreads\(\)/g) ?? []).length, 5);
  // The row is copied in once by the whole block, so the max fold reads shared memory rather than strided globals.
  assert.match(source, /q0\[m0\] = t0\[\(b\) \* \(d1\) \+ \(m0\)\]/);
  assert.match(source, /for \(I r0 = 0; r0 < end_r0; \+\+r0\) \{\n\s+v1 = minmax\(v1, q0\[\(r0\)\], true\);/);
});

test('the plan is a function of the current revision only', () => {
  const program = corpus('mlp');
  const fn = fnOf(program, 'mlp');
  assert.equal(JSON.stringify(fusePlan(fn).decisions), JSON.stringify(fusePlan(fn).decisions));
  // `inline` on mlp removes one statement; the plan follows the revision it is given.
  const optimized = optimizeTix(program, ['inline']).program;
  assert.notEqual(fusePlan(fnOf(optimized, 'mlp')).decisions.length, fusePlan(fn).decisions.length);
});
