// The meaning contract: its domain (cases), the running error bound it rests on, and its outcomes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix } from '../../dist/tensor/index.js';
import { immutable } from '../../dist/framework/core/index.js';
import { seededRandom } from '../../dist/framework/contracts/index.js';
import {
  caseInputs, checkMeaning, DOMAIN, generateCases, meaningSpec, tensorContract,
} from '../../dist/tensor/contract.js';
import { runBound, runF32, runF64 } from '../../dist/tensor/evaluate.js';
import { CORPUS, corpusSource } from './helpers.mjs';

const cases = (ir, count = DOMAIN.count, seed = DOMAIN.seed) => generateCases(ir, seededRandom(seed), count);

test('cases are deterministic, plain JSON, and inside the domain', () => {
  for (const name of CORPUS) {
    const ir = compileTix(corpusSource(name)).origin.value;
    const a = cases(ir), b = cases(ir);
    assert.equal(a.length, DOMAIN.count, name);
    assert.deepEqual(a, b);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
    immutable(a); // what evidence passes through on the manager path: throws on typed arrays and non-finite numbers
    for (const c of a) {
      for (const v of Object.values(c.shapes)) assert.ok(Number.isInteger(v) && v >= 1 && v <= 8);
      const inputs = caseInputs(ir, c);
      assert.deepEqual(Object.keys(inputs), ir.fns[name].params.map(p => p.name));
      for (const t of Object.values(inputs)) {
        assert.ok(t.data instanceof Float32Array && t.shape.every(d => d >= 1));
        assert.ok(t.data.every(v => v >= -4 && v < 4));
      }
      const same = caseInputs(ir, { ...c }); // regenerated from the seed, not remembered
      assert.deepEqual(same, inputs);
    }
  }
  const a = cases(compileTix(corpusSource('matmul')).origin.value, 4, 7);
  const b = cases(compileTix(corpusSource('matmul')).origin.value, 4, 8);
  assert.notDeepEqual(a, b);
});

test('a binding with an extent below 1 is redrawn (conv2d needs H >= KH and W >= KW)', () => {
  const ir = compileTix(corpusSource('conv2d')).origin.value;
  const all = cases(ir, 64);
  assert.equal(all.length, 64);
  for (const c of all) assert.ok(c.shapes.H >= c.shapes.KH && c.shapes.W >= c.shapes.KW);
  assert.ok(all.some(c => c.shapes.H === c.shapes.KH), 'the smallest valid extent, 1, occurs');
});

test('the f32 result of every corpus program is within its running error bound of the f64 result', () => {
  for (const name of CORPUS) {
    const ir = compileTix(corpusSource(name)).origin.value;
    let worst = 0, decided = 0, inconclusive = 0;
    for (const c of cases(ir, 48)) {
      const inputs = caseInputs(ir, c);
      const ref = runF64(ir, name, inputs).data;
      if (!ref.every(Number.isFinite)) { inconclusive++; continue; }
      const got = runF32(ir, name, inputs).data, { value, bound } = runBound(ir, name, inputs);
      assert.deepEqual(value, ref, 'the bound arithmetic computes the f64 values');
      if (!bound.every(Number.isFinite)) { inconclusive++; continue; }
      decided++;
      for (let i = 0; i < ref.length; i++) {
        const err = Math.abs(got[i] - ref[i]);
        assert.ok(err <= bound[i], `${name}#${c.n}[${i}]: error ${err} above the bound ${bound[i]}`);
        if (err > 0) worst = Math.max(worst, err / bound[i]);
      }
    }
    // the bound is not vacuous: the worst case uses a visible share of it
    assert.ok(worst > 0.01 && worst <= 1, `${name}: worst error/bound ${worst}`);
    assert.ok(decided >= 16, `${name}: ${decided} decided, ${inconclusive} inconclusive`);
    console.log(`  ${name}: worst error/bound ${worst.toFixed(3)}, ${decided} decided, ${inconclusive} inconclusive`);
  }
});

test('a program checked against itself agrees under both relations', () => {
  for (const name of CORPUS) {
    const { origin } = compileTix(corpusSource(name));
    for (const relation of ['exact', 'tolerance']) {
      const r = checkMeaning(relation, { origin, input: origin, output: origin });
      assert.equal(r.ok, true, `${name} ${relation}: ${r.reason}`);
      assert.equal(r.evidence.total, DOMAIN.count);
      assert.equal(r.evidence.agree + r.evidence.inconclusive, DOMAIN.count);
    }
  }
});

test('a reference that is not finite is inconclusive, and a check with no decided case fails', () => {
  // log of a value in [-4, 4): with 8 or fewer elements some case may be all positive, so square and negate
  const { origin } = compileTix('fn f(x: f32[N]): f32[N] { y[i] = log(0 - x[i] * x[i] - 1); return y; }');
  const tol = checkMeaning('tolerance', { origin, input: origin, output: origin });
  assert.equal(tol.ok, false);
  assert.equal(tol.evidence.status, 'inconclusive');
  assert.equal(tol.evidence.inconclusive, DOMAIN.count);
  // exact compares bits, NaN included
  assert.equal(checkMeaning('exact', { origin, input: origin, output: origin }).ok, true);
});

test('exact compares bits: -0 is not 0', () => {
  const a = compileTix('fn f(x: f32[N]): f32[N] { y[i] = 0 * x[i]; return y; }').origin;
  const b = compileTix('fn f(x: f32[N]): f32[N] { y[i] = 0 * x[i] + 0; return y; }').origin;
  const exact = checkMeaning('exact', { origin: a, input: a, output: b });
  assert.equal(exact.ok, false);
  assert.match(exact.reason, /element \d+ is 0, the reference has -0|element \d+ is -0, the reference has 0/);
  // both are exactly zero, and the bound of an exact zero is zero
  assert.equal(checkMeaning('tolerance', { origin: a, input: a, output: b }).ok, true);
});

test('a candidate with another signature or result is rejected with a reason', () => {
  const a = compileTix('fn f(x: f32[N]): f32[N] { y[i] = x[i] + 1; return y; }').origin;
  const renamed = compileTix('fn g(x: f32[N]): f32[N] { y[i] = x[i] + 1; return y; }').origin;
  const shape = compileTix('fn f(x: f32[N]): f32[N, 2] { y[i, j]: f32[N, 2] = x[i] + 1; return y; }').origin;
  const off = compileTix('fn f(x: f32[N]): f32[N] { y[i] = x[i] + 1.000001; return y; }').origin;
  for (const relation of ['exact', 'tolerance']) {
    assert.match(checkMeaning(relation, { origin: a, input: a, output: renamed }).reason, /the candidate failed: no function 'f'/);
    assert.match(checkMeaning(relation, { origin: a, input: a, output: shape }).reason, /shape \[\d,2\] instead of \[\d\]/);
    assert.equal(checkMeaning(relation, { origin: a, input: a, output: off }).ok, false, relation);
  }
  assert.match(checkMeaning('tolerance', { origin: a, input: a, output: off }).reason, /off by .*, allowed /);
});

test('one spec and one contract object exists per relation, count and seed', () => {
  assert.equal(tensorContract('exact'), tensorContract('exact', { count: DOMAIN.count, seed: DOMAIN.seed }));
  assert.equal(meaningSpec('tolerance'), meaningSpec('tolerance', {}));
  assert.notEqual(tensorContract('exact'), tensorContract('tolerance'));
  assert.notEqual(tensorContract('exact'), tensorContract('exact', { count: 4 }));
  assert.notEqual(tensorContract('exact').version, tensorContract('exact', { count: 4 }).version);
});
