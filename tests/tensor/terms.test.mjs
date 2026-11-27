// IRWB-030-D: which reductions compute their terms in parallel, decided by planFusion from the Tix IR. Local.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileTix, cudaSource } from '../../dist/tensor/index.js';
import { fuseAt, gate, planFusion } from '../../dist/tensor/fusion.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const fnOf = (program, name) => program.current.value.functions.find(f => f.name === (name ?? f.name));
const terms = (program, name) =>
  planFusion(fnOf(program, name)).groups.flatMap(g =>
    g.terms.map(t => [t.statement, t.reduction, t.staged, t.reason]),
  );
const kernels = source => (source.match(/__global__ void/g) ?? []).length;

const layernormInside =
  compileTix(`fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
  mean[i] = sum(j) x[i,j] / D;
  centered[i,j] = x[i,j] - mean[i];
  variance[i] = sum(j) centered[i,j] * centered[i,j] / D;
  y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
  return y;
}`);

test('a row scalar stages a reduction whose body has a multi-instruction operation; loads and one multiply stay on thread 0', () => {
  const staged = 'all threads compute the terms into a term buffer; thread 0 folds them in order';
  assert.deepEqual(terms(layernormInside), [
    ['mean', 0, true, staged],
    ['variance', 0, true, staged],
  ]);
  assert.deepEqual(
    terms(corpus('layernorm')).map(t => t.slice(0, 3)),
    [
      ['mean', 0, false],
      ['variance', 0, false],
    ],
  );
  const [mean, variance] = terms(corpus('layernorm'));
  assert.match(mean[3], /the term is a load or a constant/);
  assert.match(variance[3], /single-instruction/);
  const source = cudaSource(layernormInside, 'layernorm');
  assert.equal(kernels(source), 1);
  assert.equal((source.match(/rterms\[e\] = /g) ?? []).length, 2);
  assert.match(
    source,
    /if \(threadIdx\.x == 0\) for \(U e = 0; e < chunk; \+\+e\) v\d+ = __fadd_rn\(v\d+, rterms\[e\]\);/,
  );
  assert.doesNotMatch(cudaSource(layernormInside, 'layernorm', { fuse: false }), /rterms/);
});

test('reductions of members with trailing axes, of thread-mode kernels and inside other reductions are not staged', () => {
  const attention = terms(corpus('attention'));
  assert.deepEqual(
    attention.map(t => t.slice(0, 3)),
    [
      ['score', 0, false],
      ['shift', 0, false],
      ['z', 0, false],
      ['out', 0, false],
    ],
  );
  assert.match(attention[0][3], /computed per element by its own thread/);
  assert.match(attention[1][3], /a load or a constant/);
  const p = compileTix(`
    fn nested(x:f32[N,C], z:f32[N,C]):f32[N,C] { s[i] = sum(j) (x[i,j] * sum(j) z[i,j] / 2); y[i,j] = x[i,j] / s[i]; return y; }
    fn two(x:f32[N,C]):f32[N,C] { s[i] = (sum(j) x[i,j] / 3) + (max(j) exp(x[i,j])) - sum(j) x[i,j]; y[i,j] = x[i,j] - s[i]; return y; }
    fn chain(x:f32[N]):f32[N] { a[i] = x[i] * 2; b[i] = a[i] / 3; return b; }
  `);
  assert.deepEqual(
    terms(p, 'nested').map(t => t.slice(0, 3)),
    [['s', 0, true]],
  );
  assert.deepEqual(
    terms(p, 'two').map(t => t.slice(0, 3)),
    [
      ['s', 0, true],
      ['s', 1, true],
      ['s', 2, false],
    ],
  );
  assert.deepEqual(terms(p, 'chain'), []);
  assert.deepEqual(
    planFusion(fnOf(p, 'two'), { terms: 'none' }).groups[0].terms.map(t => t.staged),
    [false, false, false],
  );
});

test('the gate keeps a program on stage 2 when a block-mode kernel has only short rows', () => {
  const softmax = fnOf(corpus('softmax'));
  const plan = planFusion(softmax);
  const at = (N, C) =>
    fuseAt(
      softmax,
      plan,
      new Map([
        ['N', N],
        ['C', C],
      ]),
    );
  assert.equal(at(4096, 1024).fuse, true);
  assert.equal(at(1, 2 ** 22).fuse, true);
  assert.equal(at(2 ** 20, gate.shortestRow).fuse, true);
  const short = at(2 ** 20, gate.shortestRow - 1);
  assert.equal(short.fuse, false);
  assert.match(short.reason, /k0's longest row has \d+ elements, fewer than \d+: stage 2 is faster/);
  // the longest row counts: attention's out rows have V elements even when the score rows (K) are short
  const attention = fnOf(corpus('attention'));
  const shapes = K =>
    new Map([
      ['Q', 4096],
      ['K', K],
      ['D', 64],
      ['V', 64],
    ]);
  assert.equal(fuseAt(attention, planFusion(attention), shapes(4)).fuse, true);
  // thread-mode programs have no block-mode kernel, so the gate never applies
  const matmul = fnOf(corpus('matmul'));
  assert.equal(
    fuseAt(
      matmul,
      planFusion(matmul),
      new Map([
        ['M', 1],
        ['K', 1],
        ['N', 1],
      ]),
    ).fuse,
    true,
  );
});
