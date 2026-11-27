// IRWB-030-G: parallel terms and the cost gate on the GB10. Needs the GPU machine (tools/cuda-remote.mjs).
//
// The exact relation is the point: a staged term is the same expression rounded the same way, and the fold visits
// the terms in the meaning's order, so the fused kernel must equal the current revision's f32 meaning word for
// word. The mutants show that the check notices when it does not.
import assert from 'node:assert/strict';
import test from 'node:test';
import { seededRandom } from '../../dist/framework/contracts/index.js';
import { checkLowering, compileTix, cudaSource, runTix, runTixCuda } from '../../dist/tensor/index.js';
import { checkCudaLowering, cudaArtifact } from '../../dist/tensor/cuda-contract.js';
import { planFusion } from '../../dist/tensor/fusion.js';
import { value } from '../../dist/tensor/model.js';

const words = ({ data }) => new Uint32Array(data.buffer, data.byteOffset, data.length);
const kernels = source => (source.match(/__global__ void/g) ?? []).length;
const same = (a, b) =>
  a.length === b.length && a.every((w, i) => w === b[i] || (Number.isNaN(w) && Number.isNaN(b[i])));

// the brief's "inside" placements: the divisions run inside the reductions
const inside = compileTix(`
  fn layernorm_inside(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
    mean[i] = sum(j) x[i,j] / D;
    centered[i,j] = x[i,j] - mean[i];
    variance[i] = sum(j) centered[i,j] * centered[i,j] / D;
    y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
    return y;
  }
  fn attention_inside(q: f32[Q,D], k: f32[K,D], v: f32[K,V]): f32[Q,V] {
    score[i,j] = sum(d) q[i,d] * k[j,d] / sqrt(D);
    shift[i] = max(j) score[i,j];
    e[i,j] = exp(score[i,j] - shift[i]);
    l[i] = sum(j) e[i,j];
    out[i,c] = sum(j) e[i,j] * v[j,c] / l[i];
    return out;
  }
  fn exp_in_sum(x: f32[N,C]): f32[N,C] {
    m[i] = max(j) x[i,j];
    s[i] = sum(j) exp(x[i,j] - m[i]);
    y[i,j] = exp(x[i,j] - m[i]) / s[i];
    return y;
  }
  fn multi(x: f32[N,C,D]): f32[N,C] {
    s[i] = sum(j,k) x[i,j,k] / D;
    m[i] = max(j) x[i,j,0] / C + s[i];
    e[i,j]: f32[N,C] = x[i,j,0] - s[i] + m[i];
    return e;
  }
  fn longterm(x: f32[N,D], z: f32[N,C]): f32[N,C] {
    s[i] = sum(j) x[i,j] / D;
    e[i,j]: f32[N,C] = z[i,j] - s[i];
    return e;
  }
  fn short(x: f32[N,C]): f32[N,C] {
    s[i] = sum(j) x[i,j] / C;
    y[i,j] = x[i,j] - s[i];
    return y;
  }
`);

test('GB10: staged terms keep the exact meaning, for costly bodies of one and of several axes', async () => {
  for (const name of ['layernorm_inside', 'attention_inside', 'exp_in_sum', 'multi', 'longterm'])
    assert.deepEqual(
      await checkLowering(inside, name),
      { accepted: true, relation: 'exact' },
      name + ': ' + (await checkLowering(inside, name)).reason,
    );
});

test('GB10: staged terms equal the interpreter at full size, including rows too large for shared memory', async () => {
  const random = seededRandom(31);
  const cases = [
    // 2 arrays of D terms plus the row: 64 rows of 16384, so the row set goes to global scratch
    ['layernorm_inside', { N: 64, D: 16384 }, 'beta,eps,gamma,x'],
    ['exp_in_sum', { N: 512, C: 1024 }, 'x'],
    ['multi', { N: 32, C: 64, D: 32 }, 'x'],
    ['longterm', { N: 256, D: 1024, C: 8 }, 'x,z'],
  ];
  for (const [name, sizes, params] of cases) {
    const fn = inside.current.value.functions.find(f => f.name === name);
    const dims = new Map(Object.entries(sizes));
    const inputs = {};
    for (const param of fn.params) {
      const shape = param.shape.map(d => value(d, dims));
      const n = shape.reduce((a, b) => a * b, 1);
      inputs[param.name] = {
        shape,
        data: Float32Array.from({ length: n }, () => (param.name === 'eps' ? 1e-5 : 8 * random() - 4)),
      };
    }
    assert.deepEqual(Object.keys(inputs).sort(), params.split(','), name);
    const reference = runTix(inside, name, inputs);
    const fused = await runTixCuda(inside, name, inputs);
    assert.ok(same(words(reference), words(fused)), name + ' fused');
    const unfused = await runTixCuda(inside, name, inputs, { fuse: false });
    assert.ok(same(words(fused), words(unfused)), name + ' against stage 2');
  }
});

test('GB10: the gate falls back to stage 2 for a short row, and that lowering is exact too', async () => {
  const sizes = { N: 4096, C: 8 };
  const fn = inside.current.value.functions.find(f => f.name === 'short');
  const plan = planFusion(fn, sizes);
  assert.equal(plan.gate.length, 1);
  assert.equal(plan.gate[0].width, 8);
  const gated = cudaSource(inside, 'short', { sizes });
  assert.equal(kernels(gated), 2);
  assert.equal(kernels(cudaSource(inside, 'short')), 1); // without shape values the group stays fused
  // the gated source, checked as a supplied candidate under the exact relation
  const candidate = cudaArtifact(
    'short',
    gated,
    plan.groups.map(g => ({ name: g.kernel, mapping: g.mapping, statements: g.statements })),
  );
  assert.deepEqual(await checkCudaLowering(inside.current, 'short', candidate), {
    accepted: true,
    relation: 'exact',
  });
  // and the public path runs it: the same words as the interpreter and as stage 2
  const x = {
    shape: [sizes.N, sizes.C],
    data: Float32Array.from({ length: sizes.N * sizes.C }, () => Math.sin(1 + Math.cos(2))),
  };
  const model = runTix(inside, 'short', { x });
  const gatedResult = await runTixCuda(inside, 'short', { x });
  assert.ok(same(words(model), words(gatedResult)));
  assert.ok(same(words(model), words(await runTixCuda(inside, 'short', { x }, { fuse: false }))));
});

test('GB10: the exact check rejects a fold that reverses the term array or reads a stale one', async () => {
  const p = compileTix(
    'fn f(x: f32[N,C]): f32[N,C] { s[i] = sum(j) x[i,j] / C; y[i,j] = x[i,j] - s[i]; return y; }',
  );
  const source = cudaSource(p, 'f');
  assert.match(source, /a0\[q0\] = v\d+;/);
  const plain = [{ name: 'k0', mapping: 'block', statements: ['s', 'y'] }];
  // the terms are written in reverse, so the fold adds them in reverse: the sum rounds differently
  const reversed = source.replace('a0[q0] = ', 'a0[na0 - 1 - q0] = ');
  assert.notEqual(reversed, source);
  // the fold skips the first term of every row
  const skipped = source.replace(/U f0 = 0;/, 'U f0 = 1;');
  assert.notEqual(skipped, source);
  for (const mutant of [reversed, skipped]) {
    const verdict = await checkCudaLowering(p.current, 'f', cudaArtifact('f', mutant, plain));
    assert.equal(verdict.accepted, false);
    assert.match(verdict.reason, /At \[.*\], expected .* got/);
  }
  assert.deepEqual(await checkLowering(p, 'f'), { accepted: true, relation: 'exact' });
});
