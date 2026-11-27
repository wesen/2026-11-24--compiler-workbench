// IRWB-033-F: the tiled contraction schedule, checked on the GB10. Needs the GPU machine (tools/cuda-remote.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLowering, compileTix, cudaSource, runTix, runTixCuda } from '../../dist/tensor/index.js';
import { runCudaBatch } from '../../dist/tensor/cuda-runtime.js';
import { lowerSchedule } from '../../dist/tensor/schedule.js';

const words = ({ data }) => new Uint32Array(data.buffer, data.byteOffset, data.length);
const equal = (a, b) => {
  const wa = words(a),
    wb = words(b);
  for (let i = 0; i < wa.length; i++)
    if (wa[i] !== wb[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return `word ${i}`;
  return 'equal';
};

const features = compileTix(`
  fn plain(a:f32[M,K], b:f32[K,N]):f32[M,N] { y[i,j] = sum(k) a[i,k]*b[k,j]; return y; }
  fn bias(a:f32[M,K], b:f32[K,N], c:f32[N]):f32[M,N] { y[i,j] = (sum(k) a[i,k]*b[k,j]) + c[j]; return y; }
  fn scaled(a:f32[M,K], b:f32[K,N]):f32[M,N] { y[i,j] = (sum(k) a[i,k]*b[k,j]) / sqrt(K); return y; }
  fn transposed(a:f32[K,M], b:f32[K,N]):f32[M,N] { y[i,j] = sum(k) a[k,i]*b[k,j]; return y; }
  fn vector(a:f32[M,K], c:f32[K]):f32[M,M] { y[i,j]: f32[M,M] = sum(k) a[i,k]*c[k]; return y; }
  fn biggest(a:f32[M,K], b:f32[K,N]):f32[M,N] { y[i,j] = max(k) a[i,k]*b[k,j]; return y; }
`);

test('GB10: tiled contractions are exact on both sides of the gate, at odd and tiny shapes', async () => {
  const cases = [
    ['plain', [37, 23, 11]],
    ['plain', [5, 1, 7]],
    ['plain', [65, 65, 65]],
    ['plain', [4, 0, 4]],
    ['bias', [130, 65, 100]],
    ['scaled', [33, 64, 96]],
    ['transposed', [96, 33, 65]],
    ['vector', [65, 100]],
    ['biggest', [37, 23, 11]],
  ];
  for (const [fn, sizes] of cases) {
    const f = features.current.value.functions.find(f => f.name === fn);
    // every parameter's shape names, in order, get the case's sizes
    const symbols = [...new Set(f.params.flatMap(p => p.shape.map(d => d.terms[0]?.[0]).filter(Boolean)))];
    const dims = new Map(symbols.map((n, i) => [n, sizes[i] ?? sizes.at(-1)]));
    const inputs = Object.fromEntries(
      f.params.map(p => [
        p.name,
        {
          shape: p.shape.map(d => d.terms[0]?.[0] ? dims.get(d.terms[0][0]) : d.constant),
          data: Float32Array.from(
            {
              length: p.shape.reduce(
                (n, d) => n * (d.terms[0]?.[0] ? (dims.get(d.terms[0][0]) ?? 0) : d.constant),
                1,
              ),
            },
            () => 0.2 * Math.random() - 0.1,
          ),
        },
      ]),
    );
    const expected = runTix(features, fn, inputs);
    const source = cudaSource(features, fn);
    assert.match(source, /template <int Mode, int Dbl/); // the contraction is tiled
    for (const gate of ['fused', 'unfused']) {
      const [got] = await runCudaBatch(source, f, [inputs], { gate });
      assert.equal(equal(expected, got), 'equal', `${fn} ${sizes} gate=${gate}`);
    }
  }
});

test('GB10: the launch rule dispatches by size and every side is exact', async () => {
  const f = features.current.value.functions.find(f => f.name === 'plain');
  const source = cudaSource(features, 'plain');
  // below minWork output elements the rule runs the element mapping; above, the tiled schedule
  const schedule = lowerSchedule(f, true);
  const minWork = schedule.kernels[0].tile.dispatch.minWork;
  for (const [M, K, N] of [
    [16, 16, 16],
    [181, 181, 1],
    [182, 182, 1],
    [64, 3, 512],
    [512, 512, 512],
  ]) {
    const inputs = {
      a: { shape: [M, K], data: Float32Array.from({ length: M * K }, () => 0.2 * Math.random() - 0.1) },
      b: { shape: [K, N], data: Float32Array.from({ length: K * N }, () => 0.2 * Math.random() - 0.1) },
    };
    const expected = runTix(features, 'plain', inputs);
    const [got] = await runCudaBatch(source, f, [inputs]);
    assert.equal(equal(expected, got), 'equal', `${M}x${K}x${N}`);
    assert.equal(got.gates.k0, M * N >= minWork ? 'fused' : 'unfused');
  }
});

test('GB10: the tiled matmul lowering passes the exact contract, both sides of the gate', async () => {
  for (const fuse of [true, false]) {
    const verdict = await checkLowering(features, 'plain', { fuse });
    assert.deepEqual(verdict, { accepted: true, relation: 'exact' }, `fuse=${fuse}`);
  }
  // the whole corpus still passes fused (attention, mlp and conv2d keep stages 3 and 3b)
  for (const name of ['softmax', 'attention', 'mlp', 'conv2d']) {
    const program = compileTix(
      (await import('node:fs')).readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'),
    );
    const verdict = await checkLowering(program, name);
    assert.deepEqual(verdict, { accepted: true, relation: 'exact' }, name);
  }
});
