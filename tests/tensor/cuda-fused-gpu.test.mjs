// The fused lowering, checked on the GB10 under the exact relation, and word-compared with the f32 meaning at sizes
// the contract's sampled cases do not reach.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { checkLowering, compileTix, cudaSource, optimizeTix, runTix, runTixCuda } from '../../dist/tensor/index.js';
import { planFusion } from '../../dist/tensor/fusion.js';

const buf = (shape, data) => ({ shape, data: Float32Array.from(data) });
const words = ({ data }) => new Uint32Array(data.buffer, data.byteOffset, data.length);
const corpus = name => readFile(new URL('../../corpus/tensor/' + name + '/main.tix', import.meta.url), 'utf8');
const kernels = text => (text.match(/__global__ void/g) ?? []).length;

for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  test('GB10 accepts the fused lowering of ' + name + ' as exact, before and after stage 1 rewrites', async () => {
    const program = compileTix(await corpus(name));
    const optimized = optimizeTix(program, ['inline', 'split-sum']).program;
    for (const [label, revision] of [
      ['original', program],
      ['optimized', optimized],
    ]) {
      const verdict = await checkLowering(revision, name, { fuse: true });
      assert.equal(verdict.accepted, true, label + ': ' + verdict.reason);
      assert.equal(verdict.relation, 'exact');
      assert.equal(kernels(cudaSource(revision, name)), 1, label + ' kernel count');
    }
  });
}

test('GB10 fused kernels match the f32 meaning word for word at unsampled shapes', async () => {
  // lane extents above and below the 128-thread block, and rows shorter than a warp
  const cases = [
    {
      name: 'softmax',
      source:
        'fn softmax(x:f32[N,C]):f32[N,C] { m[i]=max(j) x[i,j]; e[i,j]=exp(x[i,j]-m[i]); s[i]=sum(j) e[i,j]; y[i,j]=e[i,j]/s[i]; return y; }',
      params: { x: ['N', 'C'] },
      dims: { N: 5, C: 300 },
    },
    {
      name: 'layernorm',
      source:
        'fn layernorm(x:f32[N,D], g:f32[D], b:f32[D], eps:f32[1]):f32[N,D] { mean[i]=(sum(j) x[i,j])/D; c[i,j]=x[i,j]-mean[i]; v[i]=(sum(j) c[i,j]*c[i,j])/D; y[i,j]=c[i,j]/sqrt(v[i]+eps[0])*g[j]+b[j]; return y; }',
      params: { x: ['N', 'D'], g: ['D'], b: ['D'] },
      dims: { N: 3, D: 40, eps: 1 },
    },
    {
      name: 'attention',
      source:
        'fn attention(q:f32[Q,D], k:f32[K,D], v:f32[K,V]):f32[Q,V] { score[i,j]=(sum(d) q[i,d]*k[j,d])/sqrt(D); shift[i]=max(j) score[i,j]; e[i,j]=exp(score[i,j]-shift[i]); z[i]=sum(j) e[i,j]; w[i,j]=e[i,j]/z[i]; out[i,c]=sum(j) w[i,j]*v[j,c]; return out; }',
      params: { q: ['Q', 'D'], k: ['K', 'D'], v: ['K', 'V'] },
      dims: { Q: 4, K: 6, D: 8, V: 5 },
    },
    {
      name: 'mlp',
      source:
        'fn mlp(x:f32[N,D], w:f32[D,H], bias:f32[H], v:f32[H,O], ob:f32[O]):f32[N,O] { h[i,j]=(sum(d) x[i,d]*w[d,j])+bias[j]; g[i,j]=0.5*h[i,j]*(1+tanh(0.79788456*(h[i,j]+0.044715*h[i,j]*h[i,j]*h[i,j]))); y[i,j]=(sum(k) g[i,k]*v[k,j])+ob[j]; return y; }',
      params: { x: ['N', 'D'], w: ['D', 'H'], bias: ['H'], v: ['H', 'O'], ob: ['O'] },
      dims: { N: 3, D: 6, H: 9, O: 4 },
    },
  ];
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (const { name, source, params, dims } of cases) {
    const program = compileTix(source);
    const statements = program.current.value.functions[0].statements.length;
    assert.ok(planFusion(program.current.value.functions[0]).length < statements, name + ' is fused');
    const inputs = {};
    for (const [parameter, axes] of Object.entries(params)) {
      const shape = axes.map(axis => dims[axis]);
      const count = shape.reduce((a, b) => a * b, 1);
      inputs[parameter] = { shape, data: Float32Array.from({ length: count }, () => 2 * random() - 1) };
    }
    if (name === 'layernorm') inputs.eps = { shape: [1], data: Float32Array.of(1e-5) };
    const reference = runTix(program, name, inputs);
    const fused = await runTixCuda(program, name, inputs);
    const plain = await runTixCuda(program, name, inputs, { fuse: false });
    assert.deepEqual(words(fused), words(reference), name + ' fused against the f32 meaning');
    assert.deepEqual(words(fused), words(plain), name + ' fused against stage 2');
    assert.deepEqual(fused.shape, reference.shape);
    assert.ok(Number.isFinite(fused.gpuMs) && fused.gpuMs >= 0);
  }
});

test('GB10 fused row kernels handle an empty extra axis, an empty row set and a one-lane row', async () => {
  const program = compileTix(
    'fn f(x:f32[N,C]):f32[N,C] { m[i]=max(j) x[i,j]; e[i,j]=exp(x[i,j]-m[i]); s[i]=sum(j) e[i,j]; y[i,j]=e[i,j]/s[i]; return y; }',
  );
  const empty = await runTixCuda(program, 'f', { x: buf([3, 0], []) });
  assert.deepEqual(empty.shape, [3, 0]);
  assert.equal(empty.data.length, 0);
  const none = await runTixCuda(program, 'f', { x: buf([0, 4], []) });
  assert.deepEqual(none.shape, [0, 4]);
  assert.equal(none.data.length, 0);
  const single = runTix(program, 'f', { x: buf([2, 1], [1, -1]) });
  assert.deepEqual(words(await runTixCuda(program, 'f', { x: buf([2, 1], [1, -1]) })), words(single));
});

test('GB10 benchmark mode reports one warm launch and the median of three timed runs', async () => {
  const program = compileTix('fn f(x:f32[N,C]):f32[N,C] { y[i,j]=x[i,j]*2; return y; }');
  const inputs = { x: buf([64, 64], Float32Array.from({ length: 64 * 64 }, (_, i) => i / 4096)) };
  const once = await runTixCuda(program, 'f', inputs);
  for (const fuse of [false, true]) {
    const bench = await runTixCuda(program, 'f', inputs, { fuse, benchmark: true });
    assert.deepEqual(words(bench), words(once));
    assert.ok(bench.gpuMs > 0);
  }
});
