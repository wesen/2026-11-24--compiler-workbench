// IRWB-030-G: parallel terms and the cost gate, decided from the Tix IR and the launch's shape values. No GPU.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileTix, cudaSource, optimizeTix } from '../../dist/tensor/index.js';
import { blockWidth, planFusion, unfusedPlan, warp } from '../../dist/tensor/fusion.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const plan = (program, fn, sizes) =>
  planFusion(
    (program.current ?? program).value.functions.find(f => f.name === fn ?? program),
    sizes,
  );
const source = (text, fn) => compileTix(text);
const inside = source(`
  fn layernorm_inside(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
    mean[i] = sum(j) x[i,j] / D;
    centered[i,j] = x[i,j] - mean[i];
    variance[i] = sum(j) centered[i,j] * centered[i,j] / D;
    y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
    return y;
  }`);
const attentionInside = source(`
  fn attention_inside(q: f32[Q,D], k: f32[K,D], v: f32[K,V]): f32[Q,V] {
    score[i,j] = sum(d) q[i,d] * k[j,d] / sqrt(D);
    shift[i] = max(j) score[i,j];
    e[i,j] = exp(score[i,j] - shift[i]);
    l[i] = sum(j) e[i,j];
    out[i,c] = sum(j) e[i,j] * v[j,c] / l[i];
    return out;
  }`);
const kernels = text => (text.match(/__global__ void/g) ?? []).length;

test('a row-scalar reduction with a costly body stages its terms; a cheap body stays a serial fold', () => {
  const inside_ = plan(inside, 'layernorm_inside');
  assert.deepEqual(inside_.groups[0].terms, [
    { member: 'mean', reduction: 'sum(D)', terms: 'D' },
    { member: 'variance', reduction: 'sum(D)', terms: 'D' },
  ]);
  assert.deepEqual(inside_.groups[0].serial, []);
  assert.ok(inside_.groups[0].reasons.some(r => /computes the terms of sum\(D\) in mean in parallel/.test(r)));

  // the corpus writes both divisions outside the reduction, so both bodies are a load or a product
  const corpus_ = plan(corpus('layernorm'), 'layernorm');
  assert.deepEqual(corpus_.groups[0].terms, []);
  assert.deepEqual(
    corpus_.groups[0].serial.map(s => [s.member, s.reduction]),
    [
      ['mean', 'sum(D)'],
      ['variance', 'sum(D)'],
    ],
  );
  assert.match(corpus_.groups[0].serial[0].reason, /no division, transcendental or inner reduction/);
  // and no term array appears in the source
  assert.doesNotMatch(cudaSource(corpus('layernorm'), 'layernorm'), /\ba0\[/);

  const softmax = plan(corpus('softmax'), 'softmax');
  assert.deepEqual(softmax.groups[0].terms, []);
  assert.deepEqual(
    softmax.groups[0].serial.map(s => s.reduction),
    ['max(C)', 'sum(C)'],
  );
});

test('staged terms are written by the block and folded in order by one thread', () => {
  const text = cudaSource(inside, 'layernorm_inside');
  // one array per staged reduction, in the row buffer after the members' rows
  assert.match(text, /float\* const a0 = r6 \+ n6;/);
  assert.match(text, /float\* const a1 = a0 \+ na0;/);
  // the block writes the terms, one per thread
  assert.match(text, /for \(U q0 = threadIdx\.x; q0 < na0; q0 \+= blockDim\.x\) \{/);
  assert.match(text, /a0\[q0\] = v\d+;/);
  // thread 0 folds them in the meaning's order, through a counter that the staging loop cannot see
  assert.match(text, /U f0 = 0;\s*\n\s*const I end_i\d+ = \(d1\);/);
  assert.match(text, /v\d+ = __fadd_rn\(v\d+, a0\[f0\]\);\s*\n\s*\+\+f0;/);
  // one barrier between the terms and the fold
  assert.match(text, /a0\[q0\] = v\d+;\s*\n\s*\}\s*\n\s*__syncthreads\(\);/);
});

test('two staged reductions in one member get an array each and one barrier after both', () => {
  const p = source(`
    fn two(x: f32[N,C], z: f32[N,C]): f32[N,C] {
      s[i] = (sum(j) x[i,j] / C) + (sum(j) z[i,j] / C);
      y[i,j] = x[i,j] - s[i];
      return y;
    }`);
  const group = plan(p, 'two').groups[0];
  assert.deepEqual(group.terms.map(t => [t.member, t.reduction]), [
    ['s', 'sum(C)'],
    ['s', 'sum(C)'],
  ]);
  const text = cudaSource(p, 'two');
  // both arrays live in the row buffer, after the members' rows
  assert.match(text, /float\* const a0 = r2 \+ n2;\s*\n\s*float\* const a1 = a0 \+ na0;/);
  // each staging loop is followed by the next one, and a single barrier separates them from the fold
  assert.match(text, /a0\[q0\] = v\d+;\s*\n\s*\}\s*\n\s*for \(U q1 = threadIdx\.x;/);
  assert.match(text, /a1\[q1\] = v\d+;\s*\n\s*\}\s*\n\s*__syncthreads\(\);/);
  // and the fold keeps its own counter per reduction
  assert.match(text, /U f0 = 0;/);
  assert.match(text, /U f1 = 0;/);
});

test('a reduction in a row member is refused: its terms are per element, and each fold keeps its order', () => {
  const p = plan(attentionInside, 'attention_inside');
  assert.deepEqual(p.groups[0].terms, []);
  const reasons = Object.fromEntries(p.groups[0].serial.map(s => [s.member + ' ' + s.reduction, s.reason]));
  assert.match(reasons['score sum(D)'], /1 axis beyond the block domain/);
  assert.match(reasons['out sum(K)'], /1 axis beyond the block domain/);
  assert.match(reasons['l sum(K)'], /no division, transcendental or inner reduction/);
  assert.match(reasons['shift max(K)'], /no division, transcendental or inner reduction/);
});

test('several axes, a max, and a nested reduction in a fold body', () => {
  const p = source(`
    fn multi(x: f32[N,C,D]): f32[N,C] {
      s[i] = sum(j,k) x[i,j,k] / D;
      m[i] = max(j) x[i,j,0] / C + s[i];
      e[i,j]: f32[N,C] = x[i,j,0] - s[i] + m[i];
      return e;
    }`);
  const groups = plan(p, 'multi').groups;
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].terms, [
    { member: 's', reduction: 'sum(C,D)', terms: 'C * D' },
    { member: 'm', reduction: 'max(C)', terms: 'C' },
  ]);
  const text = cudaSource(p, 'multi');
  // the flat term index is split into the reduction's indices, innermost axis first
  assert.match(text, /U at0 = q0;\s*\n\s*const I i\d+ = at0 % \(d2\);\s*\n\s*at0 \/= \(d2\);/);
  // the max fold over staged terms keeps max_nan
  assert.match(text, /max_nan\(v\d+, a1\[f1\]\)/);
  // a nested reduction counts as a costly body
  const nested = plan(
    source('fn f(x: f32[N,C], z: f32[N,C]): f32[N,C] { s[i] = sum(j) z[i,j] * sum(j) x[i,j]; y[i,j] = x[i,j] - s[i]; return y; }'),
    'f',
  );
  assert.deepEqual(nested.groups[0].terms.map(t => [t.member, t.reduction]), [['s', 'sum(C)']]);
});

test('the gate keeps a group whose block is under a warp unfused, and states the width it measured', () => {
  const short = plan(corpus('softmax'), 'softmax', { N: 131072, C: 16 });
  assert.deepEqual(
    short.groups.map(g => [g.mapping, g.statements.join(',')]),
    [
      ['thread', 'm'],
      ['thread', 'e'],
      ['thread', 's'],
      ['thread', 'y'],
    ],
  );
  assert.equal(short.gate.length, 1);
  assert.equal(short.gate[0].width, 16);
  assert.match(short.gate[0].reason, new RegExp(`under the ${warp}-lane warp`));
  assert.match(short.groups[0].reasons[0], /widest row is 16 elements/);
  assert.equal(kernels(cudaSource(corpus('softmax'), 'softmax', { sizes: { N: 131072, C: 16 } })), 4);

  // one warp is enough, and without shape values the rule cannot fire
  const wide = plan(corpus('softmax'), 'softmax', { N: 32768, C: 32 });
  assert.deepEqual(wide.groups.map(g => [g.mapping, g.statements.length]), [['block', 4]]);
  assert.deepEqual(wide.gate, []);
  const unknown = plan(corpus('softmax'), 'softmax');
  assert.deepEqual(unknown.groups.map(g => [g.mapping, g.statements.length]), [['block', 4]]);
  assert.deepEqual(unknown.gate, []);
  assert.equal(kernels(cudaSource(corpus('softmax'), 'softmax')), 1);
  // a symbol the values do not fix leaves the width unknown: the group stays fused
  const partial = plan(corpus('softmax'), 'softmax', { N: 131072 });
  assert.deepEqual(partial.gate, []);
});

test('the gate measures the wider of the rows and the staged term arrays', () => {
  const p = source(`
    fn longterm(x: f32[N,D], z: f32[N,C]): f32[N,C] {
      s[i] = sum(j) x[i,j] / D;
      e[i,j]: f32[N,C] = z[i,j] - s[i];
      return e;
    }`);
  const group = plan(p, 'longterm', { N: 2048, D: 1024, C: 8 });
  assert.deepEqual(group.gate, []);
  assert.deepEqual(group.groups[0].terms.map(t => t.terms), ['D']);
  const tensors = new Map(
    [...p.current.value.functions[0].params, ...p.current.value.functions[0].statements].map(t => [t.name, t]),
  );
  assert.equal(blockWidth(group.groups[0], tensors, { N: 2048, D: 1024, C: 8 }), 1024);
  // the row alone would be gated
  assert.equal(blockWidth(group.groups[0], tensors, { N: 2048, D: 8, C: 8 }), 8);
  const rowOnly = plan(p, 'longterm', { N: 2048, D: 8, C: 8 });
  assert.equal(rowOnly.gate.length, 1);
});

test('a thread-mode group is never gated, and stage 2 has neither terms nor a gate', () => {
  const chain = plan(
    source('fn f(a: f32[M,K], b: f32[K,N], c: f32[N]): f32[M,N] { y[i,j] = sum(k) a[i,k]*b[k,j]; z[i,j] = y[i,j] + c[j]; return z; }'),
    'f',
    { M: 1, K: 2, N: 3 },
  );
  assert.deepEqual(chain.groups.map(g => g.mapping), ['thread']);
  assert.deepEqual(chain.gate, []);
  const unfused = unfusedPlan(corpus('layernorm').current.value.functions[0]);
  assert.ok(unfused.groups.every(g => g.terms.length === 0 && g.serial.length === 0));
  assert.deepEqual(unfused.gate, []);
});

test('a split sum stages one term per block of the split, not one per element', () => {
  const { program } = optimizeTix(inside, ['split-sum']);
  const group = planFusion(program.current.value.functions.find(f => f.name === 'layernorm_inside')).groups[0];
  assert.deepEqual(
    group.terms.map(t => [t.member, t.terms]),
    [
      ['mean', 'ceil(D/4)'],
      ['variance', 'ceil(D/4)'],
    ],
  );
  const text = cudaSource(program, 'layernorm_inside');
  // the fold visits the blocks of the split; each staged term is the tail reduction of up to four elements
  assert.match(text, /const I end_i\d+ = \(d1\) \/ 4 \+ \(\(d1\) % 4 != 0\);/);
  assert.match(text, /\(d1\) - 4LL \* i\d+\) < 4LL/);
});

test('fuse: false is unchanged by this stage: no term array, no barrier of its own', () => {
  const text = cudaSource(inside, 'layernorm_inside', { fuse: false });
  assert.equal(kernels(text), 4);
  assert.doesNotMatch(text, /\ba0\[|\bna0\b|max_nan/);
});
