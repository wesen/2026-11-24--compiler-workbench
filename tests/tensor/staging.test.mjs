// IRWB-030-F: the staging decisions in the plan, the launch-shape cost gate, and the emitted source's structure.
// CPU only; the GPU checks are in staging-gpu.test.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileTix, cudaSource, optimizeTix } from '../../dist/tensor/index.js';
import { gatedPlan, planFusion } from '../../dist/tensor/fusion.js';

const program = source => compileTix(source);
const fnOf = (p, name) =>
  name ? p.current.value.functions.find(f => f.name === name) : p.current.value.functions[0];
const staged = p =>
  planFusion(fnOf(p))
    .groups.flatMap(g => g.parallelTerms.map(t => t.description))
    .sort();

const insideLayernorm =
  program(`fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
  mean[i] = sum(d) x[i,d] / D;
  centered[i,j] = x[i,j] - mean[i];
  variance[i] = sum(d) centered[i,d] * centered[i,d] / D;
  y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
  return y;
}`);
const insideAttention = program(`fn attention(q: f32[Q,D], k: f32[K,D], v: f32[K,V]): f32[Q,V] {
  s[i,j] = sum(d) q[i,d] * k[j,d] / sqrt(D);
  m[i] = max(j) s[i,j];
  e[i,j] = exp(s[i,j] - m[i]);
  l[i] = sum(j) e[i,j];
  o[i,c] = sum(j) e[i,j] * v[j,c] / l[i];
  return o;
}`);

test('a costly body is staged; a bare load, a nested reduce and a row member are refused with reasons', () => {
  assert.deepEqual(staged(insideLayernorm), ['mean: sum(D)', 'variance: sum(D)']);
  const reasons = planFusion(fnOf(insideLayernorm)).groups[0].reasons.join(' ');
  assert.match(reasons, /terms of mean: sum\(D\), variance: sum\(D\)/);
  // The corpus (outside) placements: mean's body is a bare load, variance's is not.
  const corpus = name =>
    compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
  assert.deepEqual(staged(corpus('layernorm')), ['variance: sum(D)']);
  assert.match(
    planFusion(fnOf(corpus('layernorm'))).groups[0].reasons.join(' '),
    /sum\(D\) of mean keeps the serial fold: its body is a bare load/,
  );
  // Softmax's m and s, attention's shift and z: bare loads of a row buffer.
  assert.deepEqual(staged(corpus('softmax')), []);
  assert.deepEqual(staged(corpus('attention')), []);
  assert.match(
    planFusion(fnOf(corpus('softmax'))).groups[0].reasons.join(' '),
    /max\(C\) of m keeps the serial fold/,
  );
  // Attention's inside placement: l is a bare load, s and o are row members.
  assert.deepEqual(staged(insideAttention), []);
  const attentionReasons = planFusion(fnOf(insideAttention)).groups[0].reasons.join(' ');
  assert.match(attentionReasons, /sum\(K\) of l keeps the serial fold: its body is a bare load/);
  assert.match(attentionReasons, /reductions inside s stay serial per element/);
  assert.match(attentionReasons, /reductions inside o stay serial per element/);
});

test('a split sum stages its outer block reduction; the nested tail folds serially within each term', () => {
  const p = program(
    'fn f(x: f32[N,K]): f32[N,K] { s[i] = sum(k) x[i,k] * x[i,k]; y[i,k] = x[i,k] - s[i]; return y; }',
  );
  const { program: split } = optimizeTix(p, ['split-sum']);
  assert.deepEqual(staged(split), ['s: sum(ceil(K / 4))']);
  assert.match(
    planFusion(fnOf(split)).groups[0].reasons.join(' '),
    /nested reduction inside sum\(ceil\(K \/ 4\)\) of s folds serially within its term/,
  );
  const source = cudaSource(split, 'f');
  // The serial fallback keeps stage 3's loops, with distinct binder names in the two walks (the fill's aliases
  // must not collide with the fallback's binders).
  assert.match(source, /4LL \* i(\d+) \+ i(\d+)/);
  const [_, block, lane] = source.match(/4LL \* i(\d+) \+ i(\d+)/);
  assert.notEqual(block, lane);
});

test('multi-axis reductions, two reductions in one member, and max are staged and enumerated in order', () => {
  const p = program(
    'fn f(x: f32[N,A,B]): f32[N,A] { s[i] = (sum(a,b) (x[i,a,b] + 1) / 2) + (max(a) (x[i,a,0] * 3) - 1); y[i,a] = s[i] * x[i,a,0]; return y; }',
  );
  assert.deepEqual(staged(p), ['s: max(A)', 's: sum(A,B)']);
  const source = cudaSource(p, 'f');
  assert.match(source, /template <bool Shared, bool Staged>/);
  // Flat decomposition: the first axis divides by the product of the rest, the last takes the remainder.
  assert.match(source, /const I b0 = static_cast<I>\(f\) \/ \(nt\d+_\d+_\d+\);/);
  assert.match(source, /const I b1 = static_cast<I>\(f\) % nt\d+_\d+_\d+;/);
  // Both folds read their own buffer in order; max folds with the PTX primitive.
  assert.match(source, /for \(U t = 0; t < nt\d+_\d+; \+\+t\) v\d+ = __fadd_rn\(v\d+, q\d+_\d+\[t\]\);/);
  assert.match(source, /for \(U t = 0; t < nt\d+_\d+; \+\+t\) v\d+ = max_nan\(v\d+, q\d+_\d+\[t\]\);/);
});

test('a group without staged reductions keeps stage 3s single template', () => {
  const softmax = compileTix(corpusSource('softmax'));
  const source = cudaSource(softmax, 'softmax');
  assert.match(source, /template <bool Shared>/);
  assert.doesNotMatch(source, /Staged/);
  const p = program(
    'fn f(x: f32[N,K]): f32[N,K] { s[i] = sum(k) x[i,k]; y[i,k] = x[i,k] - s[i]; return y; }',
  );
  const fused = cudaSource(p, 'f');
  assert.match(fused, /template <bool Shared>/);
  assert.doesNotMatch(fused, /Staged/);
  // fuse: false keeps stage 2's kernels (one per statement)
  assert.equal((cudaSource(p, 'f', { fuse: false }).match(/__global__ void/g) ?? []).length, 2);
});

const corpusSource = name =>
  readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8');

test('the cost gate keeps corpus sizes fused and refuses few-row block groups with the numbers', () => {
  const corpusSizes = {
    softmax: { N: 4096, C: 1024 },
    layernorm: { N: 4096, D: 1024 },
    attention: { Q: 1024, K: 1024, D: 64, V: 64 },
    mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  };
  for (const [name, sizes] of Object.entries(corpusSizes)) {
    const p = compileTix(
      readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'),
    );
    const fn = p.current.value.functions[0];
    const gate = gatedPlan(fn, new Map(Object.entries(sizes)));
    assert.equal(gate.groups.length, 1, name);
    assert.deepEqual(gate.refusals, [], name);
  }
  // Few rows of a long row with no row reduction to equalize the serial cost: the fused mapping would run on
  // 32 x 128 threads where stage 2 runs 32 x 65536. (A group whose row-scalar reduction spans the row, like
  // layernorm's mean, stays fused at any size: stage 2 pays the same serial fold on one thread per row.)
  const elementwise = program(
    'fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {\n' +
      '  t[i] = x[i,0] * 2;\n' +
      '  y[i,j] = t[i] + x[i,j] * gamma[j] + beta[j];\n' +
      '  return y;\n' +
      '}',
  );
  const gate = gatedPlan(
    fnOf(elementwise),
    new Map([
      ['N', 32],
      ['D', 65536],
    ]),
  );
  assert.equal(gate.groups.length, 2);
  assert.deepEqual(
    gate.groups.map(g => [g.mapping, g.statements.join(',')]),
    [
      ['thread', 't'],
      ['thread', 'y'],
    ],
  );
  assert.match(gate.refusals[0].reason, /32 block points x 256 threads = 8192 fused threads/);
  assert.match(gate.refusals[0].reason, /below the measured \d+ that saturate the GPU/);
  // The measured loser, mlp at few rows (script 03: 1.78x slower fused at 8 192 fused threads), is refused.
  const mlp = compileTix(readFileSync(new URL('../../corpus/tensor/mlp/main.tix', import.meta.url), 'utf8'));
  const gatedMlp = gatedPlan(
    mlp.current.value.functions[0],
    new Map([
      ['N', 128],
      ['D', 256],
      ['H', 1024],
      ['O', 256],
    ]),
  );
  assert.equal(gatedMlp.groups.length, 3);
  assert.match(gatedMlp.refusals[0].reason, /8192 fused threads/);
  // mlp at the corpus size fuses.
  const corpusMlp = gatedPlan(
    mlp.current.value.functions[0],
    new Map([
      ['N', 1024],
      ['D', 256],
      ['H', 1024],
      ['O', 256],
    ]),
  );
  assert.equal(corpusMlp.groups.length, 1);
  assert.deepEqual(corpusMlp.refusals, []);
  // A row reduction that spans the row keeps the group fused at any size (measured: never slower).
  const spans = gatedPlan(
    fnOf(insideLayernorm, 'layernorm'),
    new Map([
      ['N', 4],
      ['D', 262144],
    ]),
  );
  assert.equal(spans.groups.length, 1);
  assert.deepEqual(spans.refusals, []);
  // A row that fits in its block's threads loses nothing and stays fused at any size.
  const short = gatedPlan(
    fnOf(insideLayernorm, 'layernorm'),
    new Map([
      ['N', 2],
      ['D', 32],
    ]),
  );
  assert.equal(short.groups.length, 1);
  assert.deepEqual(short.refusals, []);
  // Thread-mode groups are never gated: their mapping is stage 2's.
  const chain = program('fn f(x: f32[N]): f32[N] { a[i] = exp(x[i]); b[i] = a[i] * x[i]; return b; }');
  const gatedChain = gatedPlan(fnOf(chain), new Map([['N', 1]]));
  assert.equal(gatedChain.groups.length, 1);
  assert.deepEqual(gatedChain.refusals, []);
  // Without shape values the plan is the fully fused one.
  assert.deepEqual(
    gatedPlan(fnOf(insideLayernorm, 'layernorm')),
    planFusion(fnOf(insideLayernorm, 'layernorm')),
  );
});

test('runTixCuda lowerings cannot be slower than fuse: false at the gate, and cudaSource stays ungated', () => {
  // The gate's refusal path is stage 2's emitter; the emitted source has one kernel per statement.
  const elementwise = compileTix(
    'fn f(x: f32[N,C]): f32[N,C] { t[i] = x[i,0] * 2; y[i,j] = t[i] + x[i,j]; return y; }',
  );
  const fn = fnOf(elementwise);
  const gate = gatedPlan(
    fn,
    new Map([
      ['N', 32],
      ['C', 65536],
    ]),
  );
  const ungated = planFusion(fn);
  assert.notEqual(gate.groups.length, ungated.groups.length);
  // cudaSource (no shapes) is the fully fused plan: one kernel.
  const source = cudaSource(elementwise, 'f');
  assert.equal((source.match(/__global__ void/g) ?? []).length, 1);
});
