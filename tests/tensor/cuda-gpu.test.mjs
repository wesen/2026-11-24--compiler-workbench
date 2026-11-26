// Network/GPU tests only. Run separately or include explicitly in tests/tensor/*.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  compileTix,
  optimizeTix,
  cudaSource,
  checkLowering,
  runTix,
  runTixCuda,
} from '../../dist/tensor/index.js';
import { createCudaLowering } from '../../dist/tensor/cuda-pass.js';
import { cudaTarget, runCudaBatch } from '../../dist/tensor/cuda-run.js';
import { differentialStats } from '../../dist/framework/contracts/index.js';

const f = (shape, data) => ({ shape, data: Float32Array.from(data) });
const words = ({ data }) => [...new Uint32Array(data.buffer, data.byteOffset, data.length)];
function same(actual, expected) {
  assert.deepEqual(actual.shape, expected.shape);
  assert.deepEqual(words(actual), words(expected));
}
async function accepted(program, fn) {
  const result = await checkLowering(program, fn);
  assert.deepEqual(result, { accepted: true, relation: 'tolerance' }, result.reason);
}

test('all six corpus functions pass their GB10 batches before and after optimization', async () => {
  for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
    const program = compileTix(
      readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'),
    );
    await accepted(program, name);
    const opt = optimizeTix(program, ['inline', 'split-sum']);
    assert.ok(
      opt.steps.every(s => s.accepted),
      name,
    );
    await accepted(opt.program, name);
  }
});

test('GPU lowering preserves order, scope, affine inline addresses and split accumulators', async () => {
  const program = compileTix(`
    fn shade(x:f32[M,K], b:f32[M,J]):f32[M] {
      y[i] = sum(j) x[i,j] * (sum(j) b[i,j]); return y;
    }
    fn order(x:f32[M,K,J]):f32[M] { y[i] = sum(k,j) x[i,k,j]; return y; }
    fn trans(x:f32[M,M]):f32[M,M] { p[i,j] = x[i,j]+1; y[i,j] = p[j,i]*2; return y; }
    fn fold(x:f32[M,K]):f32[M] { y[i] = sum(k) x[i,k]; return y; }
    fn rect(a:f32[M,K], b:f32[K,N]):f32[M,N] { y[i,j] = sum(k) a[i,k]*b[k,j]; return y; }
  `);
  const target = cudaTarget();
  same(
    await runTixCuda(
      program,
      'shade',
      { x: f([1, 2], [2, 3]), b: f([1, 3], [5, 6, 7]) },
      { host: target.host },
    ),
    f([1], [90]),
  );
  same(await runTixCuda(program, 'order', { x: f([1, 2, 2], [2 ** 24, 1, -(2 ** 24), 1]) }), f([1], [1]));
  const trans = optimizeTix(program, ['inline']);
  assert.notEqual(trans.program.current.revision, program.current.revision);
  same(await runTixCuda(trans.program, 'trans', { x: f([2, 2], [1, 2, 3, 4]) }), f([2, 2], [4, 8, 6, 10]));
  const opt = optimizeTix(program, ['split-sum']);
  const args = { x: f([1, 7], [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24]) };
  const result = await runTixCuda(opt.program, 'fold', args);
  assert.equal(words(result)[0], 0x3f800002);
  assert.equal(words(runTix(program, 'fold', args))[0], 0x3f800000);
  assert.ok(Number.isFinite(result.gpuMs) && result.gpuMs > 0);
  same(
    await runTixCuda(program, 'rect', { a: f([2, 3], [1, 2, 3, 4, 5, 6]), b: f([3, 1], [2, 3, 4]) }),
    f([2, 1], [20, 47]),
  );
});

test('GPU ABI preserves empty tensors, identity, nonfinite outputs and signed-zero/subnormal bits', async () => {
  const program = compileTix(`
    fn extrema(x:f32[M,K]):f32[M] { y[i]:f32[M] = max(k) x[i,k]; return y; }
    fn fold(x:f32[M,K]):f32[M] { y[i]:f32[M] = sum(k) x[i,k]; return y; }
    fn identity(x:f32[N]):f32[N] { return x; }
    fn series(x:f32[N]):f32[N] { y[i] = min(x[i], -0.0); return y; }
    fn series2(x:f32[N]):f32[N] { y[i] = max(x[i]+x[i], log(-1.0)); return y; }
    fn twice(x:f32[N]):f32[N] { y[i] = x[i]+x[i]; return y; }
    fn scale(x:f32[N]):f32[N] { y[i] = exp(x[i]) + tanh(x[i]) + log(sqrt(x[i])); return y; }
  `);
  same(await runTixCuda(program, 'extrema', { x: f([2, 0], []) }), f([2], [-Infinity, -Infinity]));
  same(
    await runTixCuda(optimizeTix(program, ['split-sum']).program, 'fold', { x: f([2, 0], []) }),
    f([2], [0, 0]),
  );
  const unused = await runTixCuda(program, 'fold', { x: f([0, 3], []) });
  assert.equal(unused.gpuMs, 0);
  same(unused, f([0], []));
  const noKernels = await runTixCuda(program, 'identity', { x: f([2], [-0, 2 ** -149]) });
  assert.equal(noKernels.gpuMs, 0);
  same(noKernels, f([2], [-0, 2 ** -149]));
  same(await runTixCuda(program, 'series', { x: f([2], [0, -0]) }), f([2], [-0, -0]));
  same(await runTixCuda(program, 'twice', { x: f([1], [2 ** -149]) }), f([1], [2 ** -148]));
  assert.ok(Number.isNaN((await runTixCuda(program, 'series2', { x: f([1], [3]) })).data[0]));
  const inputs = { x: f([3], [0.25, 1, 3]) };
  const actual = await runTixCuda(program, 'scale', inputs);
  const expected = runTix(program, 'scale', inputs, { precision: 'f64' });
  actual.data.forEach((g, i) =>
    assert.ok(Math.abs(g - expected.data[i]) <= 2e-6 + 2e-5 * Math.abs(expected.data[i])),
  );
});

test('real dropped-tail candidate fails the contract; a warm good check launches no batch', async () => {
  const program = compileTix(`fn mutantFold(x:f32[M,K]):f32[M] { y[i]=sum(k) x[i,k]; return y; }`);
  const opt = optimizeTix(program, ['split-sum']);
  await accepted(opt.program, 'mutantFold');
  differentialStats(true);
  await accepted(opt.program, 'mutantFold');
  assert.equal(differentialStats().delegated, 0);
  assert.ok(differentialStats().replayed > 1);
  const invalid = createCudaLowering(runCudaBatch, fn => {
    const source = cudaSource(opt.program, fn.name);
    const dropped = source.replace(/ \+ \([^\n;]+ % 4ULL != 0\)/, '');
    assert.notEqual(source, dropped);
    return dropped;
  });
  const verdict = await invalid(opt.program, 'mutantFold', cudaTarget());
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /bindings.*at \[0\].*allowed/);
});

test('concurrent runtime data runs do not cross their results and reuse executable', async () => {
  const program = compileTix(`fn reuse(a:f32[N]):f32[N] { b[i]=a[i]+21.375; return b; }`);
  const source = cudaSource(program, 'reuse'),
    fn = program.current.value.functions[0];
  const target = cudaTarget();
  const jobs = [1, 9].map(n => runCudaBatch(source, fn, [{ a: f([1], [n]) }], target));
  const [a, b] = await Promise.all(jobs);
  same(a.results[0], f([1], [22.375]));
  same(b.results[0], f([1], [30.375]));
  assert.equal(a.remote.hash, b.remote.hash);
  assert.ok(!a.remote.compiled || !b.remote.compiled);
});
