// IRWB-030-E: staged terms and the fusion gate, checked on the GB10. Needs the GPU machine (tools/cuda-remote.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';
import { seededRandom } from '../../dist/framework/contracts/index.js';
import { checkLowering, compileTix, cudaSource, runTix, runTixCuda } from '../../dist/tensor/index.js';
import { checkCudaLowering, cudaArtifact } from '../../dist/tensor/cuda-contract.js';
import { runCudaBatch } from '../../dist/tensor/cuda-runtime.js';
import { planFusion } from '../../dist/tensor/fusion.js';

const words = ({ data }) => new Uint32Array(data.buffer, data.byteOffset, data.length);

const features = compileTix(`
  fn inside(x:f32[N,C]):f32[N,C] {
    m[i] = max(j) x[i,j];
    s[i] = sum(j) exp(x[i,j] - m[i]);
    y[i,j] = exp(x[i,j] - m[i]) / s[i];
    return y;
  }
  fn two(x:f32[N,C]):f32[N,C] {
    s[i] = (sum(j) x[i,j] / C) + max(j) sqrt(x[i,j] * x[i,j]);
    y[i,j] = x[i,j] - s[i];
    return y;
  }
  fn plane(x:f32[A,B,C]):f32[A,B,C] {
    s[a] = sum(b,c) x[a,b,c] / 3;
    y[a,b,c] = x[a,b,c] - s[a];
    return y;
  }
  fn nested(x:f32[N,C], z:f32[N,C]):f32[N,C] {
    s[i] = sum(j) (x[i,j] / sum(j) z[i,j]);
    y[i,j] = x[i,j] / s[i] + max(s[i], z[i,j]);
    return y;
  }
  fn stored(x:f32[N,C]):f32[N] {
    m[i] = max(j) tanh(x[i,j]);
    e[i,j] = x[i,j] - m[i];
    t[i] = (sum(j) e[i,j] / 7) + m[i];
    return t;
  }
  fn affine(x:f32[N,C]):f32[N-1,C] {
    m[i]: f32[N-1] = sum(j) x[i+1,j] / 2;
    y[i,j]: f32[N-1,C] = x[i+1,j] - m[i];
    return y;
  }
`);

test('GB10: staged terms are exact on both sides of the gate', async () => {
  const expected = {
    inside: ['s/0'],
    two: ['s/0', 's/1'],
    plane: ['s/0'],
    nested: ['s/0'],
    stored: ['m/0', 't/0'],
    affine: ['m/0'],
  };
  for (const [name, terms] of Object.entries(expected)) {
    const plan = planFusion(features.current.value.functions.find(f => f.name === name));
    assert.equal(plan.groups.length, 1, name);
    assert.deepEqual(
      plan.groups[0].terms.map(t => `${t.statement}/${t.reduction}`),
      terms,
      name,
    );
    const verdict = await checkLowering(features, name);
    assert.deepEqual(verdict, { accepted: true, relation: 'exact' }, name + ': ' + verdict.reason);
  }
});

test('GB10: the gate picks a side by shape, and both give the interpreter words; long rows keep terms in scratch', async () => {
  const random = seededRandom(31);
  const source = cudaSource(features, 'inside');
  const fn = features.current.value.functions.find(f => f.name === 'inside');
  // [3, 200]: rows long enough for the rule to fuse; [200, 3]: short rows, run statement by statement;
  // [2, 30000]: x, the terms and two scalars are 240 008 bytes per block, above the 99 KiB opt-in limit
  for (const shape of [
    [3, 200],
    [200, 3],
    [2, 30000],
  ]) {
    const x = { shape, data: Float32Array.from({ length: shape[0] * shape[1] }, () => 8 * random() - 4) };
    const expected = words(runTix(features, 'inside', { x }));
    assert.deepEqual(words(await runTixCuda(features, 'inside', { x })), expected, 'rule ' + shape);
    for (const gate of ['fused', 'unfused']) {
      const [forced] = await runCudaBatch(source, fn, [{ x }], { gate });
      assert.deepEqual(words(forced), expected, `${gate} ${shape}`);
    }
  }
});

test('GB10: the exact check rejects a reversed fold over terms, a misplaced term and a wrong per-statement side', async () => {
  const p = compileTix(
    'fn f(x:f32[N,C]):f32[N,C] { s[i] = sum(j) x[i,j] / 3; y[i,j] = x[i,j] - s[i]; return y; }',
  );
  const source = cudaSource(p, 'f');
  const kernels = [{ name: 'k0', mapping: 'block', statements: ['s', 'y'] }];
  const mutants = {
    // thread 0 adds the terms from the last to the first
    fused: source.replace('__fadd_rn(v1, q1_0[t])', '__fadd_rn(v1, q1_0[c1_0 - 1 - t])'),
    // the term pass stores term e at slot c - 1 - e
    'fused ': source.replace('q1_0[e] = v0;', 'q1_0[c1_0 - 1 - e] = v0;'),
    // the per-statement side sums the row backwards
    unfused: source.replace('t0[((i0) * (d1) + (i1))]', 't0[((i0) * (d1) + (end_i1 - 1 - i1))]'),
  };
  for (const [side, mutant] of Object.entries(mutants)) {
    assert.notEqual(mutant, source, side);
    const verdict = await checkCudaLowering(p.current, 'f', cudaArtifact('f', mutant, kernels));
    assert.equal(verdict.accepted, false, side);
    assert.match(verdict.reason, new RegExp(`"gate":"${side.trim()}".*At \\[.*\\], expected .* got`), side);
  }
  assert.deepEqual(await checkLowering(p, 'f'), { accepted: true, relation: 'exact' });
});
