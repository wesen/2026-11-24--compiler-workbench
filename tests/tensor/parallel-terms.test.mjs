// IRWB-030-J: the term-staging and decline decisions, without the GPU (the GB10 file is parallel-terms-gpu).
import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisManager } from '../../dist/framework/contracts/index.js';
import { compileTix, cudaSource, optimizeTix } from '../../dist/tensor/index.js';
import { createCudaLowering, cudaArtifact } from '../../dist/tensor/cuda-contract.js';
import { evaluate } from '../../dist/tensor/evaluate.js';
import { emitCuda } from '../../dist/tensor/cuda-source.js';
import { blockThreads, fuseThreads, planFusion } from '../../dist/tensor/fusion.js';
import { caseShapeValues } from '../../dist/tensor/cuda-runtime.js';

const fn = (source, name) => compileTix(source).current.value.functions.find(f => f.name === name);
const shapePlan = (source, name, dims) => {
  const f = fn(source, name);
  const shapes = new Map(Object.entries(dims));
  return planFusion(f, shapes);
};
const staged = (source, name) => {
  const g = planFusion(fn(source, name)).groups[0];
  return [g.terms.map(t => `${t.member}:${t.op}(${t.axes.join(',')})`), g.termRefusals];
};

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

test('a row-scalar reduction with a rounding body gets parallel terms; bare loads and split bounds do not', () => {
  assert.deepEqual(staged(insideLayernorm, 'layernorm'), [
    ['mean:sum(i1)', 'variance:sum(i5)'],
    [],
  ]);
  // the corpus placements: the division is outside the reduction, so the body is a bare load
  const softmax = staged(
    'fn f(x: f32[N,C]): f32[N,C] { m[i] = max(j) x[i,j]; e[i,j] = exp(x[i,j] - m[i]); s[i] = sum(j) e[i,j]; y[i,j] = e[i,j] / s[i]; return y; }',
    'f',
  );
  assert.deepEqual(softmax[0], []);
  assert.deepEqual(
    softmax[1].map(r => r.member),
    ['m', 's'],
  );
  assert.match(softmax[1][0].reason, /body is a single load/);
  // split-sum's generated bounds keep stage 3's serial fold
  const split = optimizeTix(compileTix(insideLayernorm), ['split-sum']).program;
  const plan = planFusion(split.current.value.functions[0]);
  assert.equal(plan.groups[0].terms.length, 0);
  assert.ok(
    plan.groups[0].termRefusals.length >= 4 &&
      plan.groups[0].termRefusals.every(r => /not rectangular/.test(r.reason)),
  );
});

test('members with trailing axes and thread-mode groups refuse staging, with the reason', () => {
  const refusals = staged(insideAttention, 'attention')[1];
  assert.deepEqual(
    refusals.map(r => r.member),
    ['score', 'shift', 'z', 'o'],
  );
  assert.match(refusals.find(r => r.member === 'score').reason, /already spread over the block's threads/);
  assert.match(refusals.find(r => r.member === 'shift').reason, /single load/);
  // thread mode keeps stage 2's mapping: one thread per point, reductions already parallel across points
  const chain = planFusion(
    fn('fn f(x: f32[N,K]): f32[N] { s[i] = sum(k) x[i,k] * 2; y[i] = s[i] + 1; return y; }', 'f'),
  );
  assert.deepEqual(chain.groups[0].mapping, 'thread');
  assert.deepEqual(chain.groups[0].terms, []);
  assert.deepEqual(chain.groups[0].termRefusals, []);
});

test('the decline rule keeps a block group unfused only when the launch shapes starve the machine', () => {
  const softmax = 'fn f(x: f32[N,C]): f32[N,C] { m[i] = max(j) x[i,j]; e[i,j] = exp(x[i,j] - m[i]); s[i] = sum(j) e[i,j]; y[i,j] = e[i,j] / s[i]; return y; }';
  // few points, long row: declined; without shapes, or at the corpus size, or with short rows: fused
  const few = shapePlan(softmax, 'f', { N: 4, C: 1024 });
  assert.equal(few.groups.length, 4);
  assert.equal(few.declined.length, 1);
  assert.match(few.declined[0].reason, /4 points x 128 threads.*cannot fill the machine/);
  // at the corpus size nothing is declined; without shapes the default plan fuses everything
  const corpus = shapePlan(softmax, 'f', { N: 4096, C: 1024 });
  assert.deepEqual(corpus.declined, []);
  assert.equal(corpus.groups.length, 1);
  assert.equal(planFusion(fn(softmax, 'f')).declined.length, 0);
  assert.equal(shapePlan(softmax, 'f', { N: 4, C: 16 }).declined.length, 0); // short row: no parallelism is lost
  assert.equal(shapePlan(softmax, 'f', { N: 0, C: 1024 }).declined.length, 0); // empty grid: nothing runs either way
  // thread-mode groups are never declined: same threads, less traffic, fewer launches
  const chain = 'fn f(x: f32[N,K]): f32[N] { s[i] = sum(k) x[i,k] * 2; y[i] = s[i] + 1; return y; }';
  assert.equal(shapePlan(chain, 'f', { N: 1, K: 4096 }).declined.length, 0);
});

test('a declined group runs stage 2 byte for byte, and a mixed plan stores what the declined kernels read', () => {
  // group 1 is rows-only (cap 128) and stays fused; group 2's reduction reads global tensors (cap 64) and is
  // declined at these shapes; its singleton kernel reads group 1's `e`, so `e` must be stored.
  const points = Math.ceil(fuseThreads / blockThreads.rows);
  const softmax = 'fn f(x: f32[N,C]): f32[N,C] { m[i] = max(j) x[i,j]; e[i,j] = exp(x[i,j] - m[i]); s[i] = sum(j) e[i,j]; y[i,j] = e[i,j] / s[i]; return y; }';
  const declined = shapePlan(softmax, 'f', { N: 4, C: 1024 });
  assert.equal(
    emitCuda(fn(softmax, 'f'), declined),
    cudaSource(compileTix(softmax), 'f', { fuse: false }),
  );
  const mixed = `fn f(x: f32[N,C], w: f32[N-1,C]): f32[N-1,C] {
    m[i] = max(j) x[i,j];
    e[i,j] = x[i,j] - m[i];
    p[i]: f32[N-1] = max(j) (w[i,j] * e[i+1,j]);
    q[i]: f32[N-1] = p[i] + 1;
    r[i,j]: f32[N-1,C] = q[i] + w[i,j];
    return r;
  }`;
  const f = fn(mixed, 'f');
  const plan = planFusion(f, new Map(Object.entries({ N: points, C: 1024 })));
  assert.deepEqual(
    plan.groups.map(g => [g.kernel, g.mapping, g.statements.join(','), g.stored.join(',')]),
    [
      ['k0', 'block', 'm,e', 'e'],
      ['k1', 'thread', 'p', 'p'],
      ['k2', 'thread', 'q', 'q'],
      ['k3', 'thread', 'r', 'r'],
    ],
  );
  assert.deepEqual(
    plan.declined.map(d => d.statements),
    [['p', 'q', 'r']],
  );
  assert.match(plan.declined[0].reason, /cannot fill the machine/);
  assert.match(plan.refusals[0].reason, /its axis 0 has extent N \+ -1, the kernel's N/);
});

test('the emitted kernel stages the terms on every thread and folds them in order on thread 0', () => {
  const source = cudaSource(compileTix(insideLayernorm), 'layernorm');
  assert.match(source, /const U nterm0 = \(static_cast<U>\(\(d1\) > 0LL \? \(d1\) : 0LL\)\);/);
  assert.match(source, /for \(U t = threadIdx\.x; t < nterm0; t \+= blockDim\.x\) \{/);
  assert.match(source, /rterm\[t\] = v0;/);
  assert.match(source, /if \(threadIdx\.x == 0\) \{\n    float v1 = 0\.0f;\n    for \(U t = 0; t < nterm0; \+\+t\) v1 = __fadd_rn\(v1, rterm\[t\]\);/);
  assert.match(source, /float\* const rterm = r6 \+ n6;/);
  // the terms buffer is part of the row: shared memory or scratch, with the host computing the same size
  assert.match(source, /scratch \+ point \* \(n0 \+ n4 \+ n5 \+ n6 \+ nterms\)/);
  assert.match(source, /const U nterms_k0 = nterm0_k0 > nterm1_k0 \? nterm0_k0 : nterm1_k0;/);
  assert.match(source, /\+ nterms_k0\) \* sizeof\(float\)/);
  assert.match(source, /std::max<U>\(\{.*nterms_k0, static_cast<U>\(1\)\}\)/);
});

test('the artifact records which reductions each kernel computes with parallel terms', async () => {
  const batches = [];
  const engine = async (source, f, cases) => {
    batches.push(source);
    return cases.map(inputs => ({ ...evaluate(f, inputs, 'f32'), gpuMs: 0 }));
  };
  const check = createCudaLowering('tensor-test-parallel-terms', engine);
  const program = compileTix(insideLayernorm);
  const manager = new AnalysisManager();
  assert.deepEqual(await check(program.current, 'layernorm', undefined, { manager }), {
    accepted: true,
    relation: 'exact',
  });
  const execution = manager.snapshot().executions.at(-1);
  assert.deepEqual(execution.outputs.subject.value.kernels[0].parallel, [
    'mean:sum(i1)',
    'variance:sum(i5)',
  ]);
  const evidence = execution.checks.find(c => c.phase === 'correspondence').evidence;
  assert.deepEqual(evidence.evidence.parallel, [['mean:sum(i1)', 'variance:sum(i5)']]);
  // a candidate without the optional parallel list is still a valid artifact
  const subject = batches[0];
  assert.match(subject, /rterm\[t\]/);
  assert.doesNotMatch(cudaSource(program, 'layernorm', { fuse: false }), /rterm/);
});

test("caseShapeValues reads the launch's shape values and rejects inconsistent ones", () => {
  const f = fn('fn f(x: f32[N,C], w: f32[C,D]): f32[N] { y[i] = sum(j) x[i,j] + w[j,0]; return y; }', 'f');
  const shapes = caseShapeValues(f, {
    x: { shape: [4, 7], data: new Float32Array(28) },
    w: { shape: [7, 3], data: new Float32Array(21) },
  });
  assert.equal(shapes.get('N'), 4);
  assert.equal(shapes.get('C'), 7);
  assert.equal(shapes.get('D'), 3);
  assert.throws(
    () => caseShapeValues(f, { x: { shape: [4, 8], data: new Float32Array(32) }, w: { shape: [7, 3], data: new Float32Array(21) } }),
    /Inconsistent input extent C/,
  );
});
