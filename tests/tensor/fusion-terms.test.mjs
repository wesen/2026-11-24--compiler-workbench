// IRWB-030-H: term staging in block-mode row reductions, and the fuse gate.
//
// Local tests: the plan's decisions and the emitted source. The GPU checks (that the staged terms give the same
// words as the meaning) are in fusion-terms-gpu.test.mjs, so this file runs without the GPU machine.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileTix, cudaSource, loweredTix, optimizeTix } from '../../dist/tensor/index.js';
import { fusionGate, groupRow, planFusion, unfusedPlan } from '../../dist/tensor/fusion.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const program = source => compileTix(source);
const plan = source => {
  const fn = program(source).current.value.functions[0];
  return { fn, plan: planFusion(fn) };
};
const kernels = source => (source.match(/__global__ void/g) ?? []).length;
const staged = p => p.groups.flatMap(g => g.terms.map(t => `${t.member}#${t.reduction}`));

test('a row reduction whose term divides, roots or takes a transcendental stages its terms', () => {
  const inside = corpus('layernorm');
  const source = readFileSync(
    new URL('../../corpus/tensor/layernorm/main.tix', import.meta.url),
    'utf8',
  )
    .replaceAll('(sum(j) x[i,j]) / D', 'sum(j) x[i,j] / D')
    .replaceAll('(sum(j) centered[i,j] * centered[i,j]) / D', 'sum(j) centered[i,j] * centered[i,j] / D');
  const outside = planFusion(inside.current.value.functions[0]);
  // the corpus divides the reduced value: nothing per term is dearer than the staging
  assert.deepEqual(staged(outside), []);
  assert.equal(outside.groups[0].mapping, 'block');
  assert.ok(outside.groups[0].serial.some(t => t.member === 'variance' && /no dearer/.test(t.reason)));

  const divided = plan(source).plan;
  assert.deepEqual(staged(divided), ['mean#0', 'variance#0']);
  assert.ok(divided.groups[0].terms.every(t => /every term has a division/.test(t.reason)));

  const rooted = plan('fn f(x: f32[N,C]): f32[N,C] { t[i]: f32[N] = sum(j) sqrt(x[i,j]); y[i,j]: f32[N,C] = t[i]; return y; }').plan;
  assert.deepEqual(staged(rooted), ['t#0']);
  const exp = plan('fn f(x: f32[N,C]): f32[N,C] { t[i]: f32[N] = sum(j) exp(x[i,j]); y[i,j]: f32[N,C] = t[i]; return y; }').plan;
  assert.deepEqual(staged(exp), ['t#0']);
  // a global read at the reduction's own index moves out of the folding thread as well
  const global = plan(
    'fn f(x: f32[N,C], v: f32[C]): f32[N,C] { t[i]: f32[N] = sum(j) x[i,j] * v[j]; y[i,j]: f32[N,C] = t[i]; return y; }',
  ).plan;
  assert.deepEqual(staged(global), ['t#0']);
  assert.match(global.groups[0].terms[0].reason, /reads v from global memory/);
});

test('a term no dearer than the staging keeps the folding thread: the corpus programs stage nothing', () => {
  for (const name of ['softmax', 'layernorm', 'attention', 'mlp', 'matmul', 'conv2d']) {
    const p = planFusion(corpus(name).current.value.functions[0]);
    assert.deepEqual(staged(p), [], name);
    assert.equal(kernels(cudaSource(corpus(name), name)), 1, name);
  }
  // a max fold over a row buffer and a product of two row buffers: nothing on the price list
  const maxFold = plan('fn f(x: f32[N,C]): f32[N,C] { m[i]: f32[N] = max(j) x[i,j]; y[i,j]: f32[N,C] = m[i] + x[i,j]; return y; }').plan;
  assert.deepEqual(staged(maxFold), []);
  assert.match(maxFold.groups[0].serial[0].reason, /no dearer/);
  const product = plan(
    'fn f(x: f32[N,C], z: f32[N,C]): f32[N,C] { t[i]: f32[N] = sum(j) x[i,j] * z[i,j]; y[i,j]: f32[N,C] = t[i] + x[i,j]; return y; }',
  ).plan;
  assert.deepEqual(staged(product), []);
});

test('per-element reductions, nested reductions and split bounds are refused with a reason', () => {
  // attention: score's reduction is inside a member with a trailing axis, so each element folds its own
  const attention = planFusion(corpus('attention').current.value.functions[0]);
  const score = attention.groups[0].serial.find(t => t.member === 'score');
  assert.match(score.reason, /has trailing axes/);
  // a reduction inside another reduction's body is not top level
  const nested = plan(
    'fn f(x: f32[N,C]): f32[N,C] { t[i]: f32[N] = sum(j) (x[i,j] - (sum(k) x[i,k] / C) / C); y[i,j]: f32[N,C] = t[i] + x[i,j]; return y; }',
  ).plan;
  assert.deepEqual(staged(nested), ['t#0']);
  assert.equal(nested.groups[0].terms[0].member, 't');
  // split-sum rewrites a reduction's extent into blocks and tail bounds: refused, since the row buffer is sized
  // from the shape values alone
  const split = optimizeTix(
    compileTix('fn f(x: f32[N,C]): f32[N,C] { t[i]: f32[N] = sum(j) x[i,j] / C; y[i,j]: f32[N,C] = t[i]; return y; }'),
    ['split-sum'],
  );
  assert.ok(split.steps.every(s => s.accepted));
  const splitPlan = planFusion(split.program.current.value.functions[0]);
  const refusal = splitPlan.groups[0].serial.find(t => /split \(blocks or tail\) bound/.test(t.reason));
  assert.ok(refusal, 'a split bound is refused');
  assert.deepEqual(staged(splitPlan), []);
  // a thread-mode group has no block to share terms
  const thread = plan(
    'fn f(x: f32[N,C]): f32[N] { t[i] = sum(j) x[i,j] / C; y[i] = t[i] * 2; return y; }',
  ).plan;
  assert.equal(thread.groups[0].mapping, 'thread');
  assert.deepEqual(staged(thread), []);
});

test('the emitted block-mode kernel computes the terms with the block and folds them in order', () => {
  const p = program(
    'fn f(x: f32[N,C]): f32[N,C] { t[i]: f32[N] = sum(j) x[i,j] / C; y[i,j]: f32[N,C] = t[i]; return y; }',
  );
  const source = cudaSource(p, 'f');
  const prologue = source.indexOf('for (U t = threadIdx.x; t < (d1); t += blockDim.x) {');
  const fold = source.indexOf('for (U t = 0; t < (d1); ++t) v');
  assert.ok(prologue > 0, 'the block computes the terms');
  assert.ok(fold > prologue, 'the fold runs after the terms are in the row buffer');
  // the term is the scalar code stage 2 emits for the same body, and the fold is the meaning's
  assert.match(source, /__fdiv_rn\(r0\[\(i\d\)\], __ll2float_rn\(d1\)\)/);
  assert.match(source, /__fadd_rn\(v\d, terms0\[t\]\)/);
  assert.match(source, /__syncthreads\(\);\s*\n\s*for \(U e = threadIdx.x; e < n\d; e \+= blockDim.x\) \{\s*\n\s*float v\d = 0\.0f;/);
  // the region is sized and laid out on both sides from the same shape values
  assert.match(source, /const U nterms = \(d1\);/);
  // the host sizes the same region from the same shape values: the staged row, the buffered row and the terms
  assert.match(source, /const U row_k0 = \(\(static_cast<U>\(\(d1\)\)\) \+ static_cast<U>\(1\) \+ \(d1\)\) \* sizeof\(float\);/);
});

test('two staged reductions in one member get their own slots; another member reuses the region', () => {
  const one = program(
    'fn f(x: f32[N,C]): f32[N,C] { t[i]: f32[N] = (sum(j) x[i,j] / C) + (sum(j) x[i,j] * x[i,j] / C); y[i,j]: f32[N,C] = t[i]; return y; }',
  );
  const source = cudaSource(one, 'f');
  assert.match(source, /const U nterms = \(\(d1\) \+ \(d1\)\);/);
  assert.match(source, /float\* const terms0 = terms_base;/);
  assert.match(source, /float\* const terms1 = terms0 \+ \(d1\);/);
  const two = program(
    'fn f(x: f32[N,C]): f32[N,C] { a[i]: f32[N] = sum(j) x[i,j] / C; b[i]: f32[N] = sum(j) (x[i,j] - a[i]) / C; y[i,j]: f32[N,C] = b[i] + x[i,j]; return y; }',
  );
  const reused = cudaSource(two, 'f');
  // a and b are in different members, separated by barriers, so they share the region
  assert.match(reused, /float\* const terms0 = terms_base;/);
  assert.match(reused, /float\* const terms1 = terms_base;/);
  assert.match(reused, /const U nterms = \(d1\);/);
});

test('the fuse gate keeps a program on stage 2 when a block-mode row is shorter than a warp', () => {
  const { fn, plan: p } = plan(
    readFileSync(new URL('../../corpus/tensor/softmax/main.tix', import.meta.url), 'utf8'),
  );
  const at = (N, C) => fusionGate(p, fn, new Map([['N', N], ['C', C]]));
  assert.deepEqual(at(4096, 1024), { fuse: true, refusals: [] });
  assert.equal(groupRow(p.groups[0], fn, new Map([['N', 4096], ['C', 1024]])), 1024);
  assert.equal(at(131072, 32).fuse, true);
  const short = at(262144, 16);
  assert.equal(short.fuse, false);
  assert.deepEqual(short.refusals.map(r => [r.kernel, r.row]), [['k0', 16]]);
  assert.match(short.refusals[0].reason, /below one warp of 32/);
  assert.equal(at(4096, 8).fuse, false);

  // thread-mode and one-statement kernels have no lane waste to pay for
  const thread = plan('fn f(x: f32[N]): f32[N] { y[i] = x[i] * 2; z[i] = y[i] + 1; return z; }');
  assert.equal(fusionGate(thread.plan, thread.fn, new Map([['N', 4]])).fuse, true);
  assert.equal(kernels(cudaSource(program('fn f(x: f32[N]): f32[N] { y[i] = x[i] * 2; z[i] = y[i] + 1; return z; }'), 'f', { shapes: { N: 4 } })), 1);
});

test('the gate chooses the lowering a launch runs, and cudaSource reports it with shapes', () => {
  const softmax = corpus('softmax');
  // the plan-time lowering: one kernel, as the contract checks it
  assert.equal(kernels(cudaSource(softmax, 'softmax')), 1);
  assert.equal(kernels(cudaSource(softmax, 'softmax', { shapes: { N: 4096, C: 1024 } })), 1);
  const short = { N: 262144, C: 16 };
  assert.equal(kernels(cudaSource(softmax, 'softmax', { shapes: short })), 4);
  assert.equal(cudaSource(softmax, 'softmax', { shapes: short }), cudaSource(softmax, 'softmax', { fuse: false }));
  const lowered = loweredTix(softmax, 'softmax', { shapes: short });
  assert.equal(lowered.plan.groups.length, 4);
  assert.deepEqual(lowered.plan.groups, unfusedPlan(softmax.current.value.functions[0]).groups);
  assert.equal(lowered.gate.fuse, false);
  // fuse: false ignores the gate
  assert.equal(loweredTix(softmax, 'softmax', { fuse: false, shapes: short }).source, cudaSource(softmax, 'softmax', { fuse: false }));
});
