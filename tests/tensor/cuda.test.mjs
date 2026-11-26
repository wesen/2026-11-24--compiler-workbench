import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLowering, compileTix, cudaSource, optimizeTix, runTixCuda } from '../../dist/tensor/index.js';
import { checkCudaPass } from '../../dist/tensor/cuda-contract.js';
import { cudaEngine, decodeResults, encodeCases } from '../../dist/tensor/cuda-run.js';
import { evaluate } from '../../dist/tensor/evaluate.js';

const sumSource = 'fn f(x: f32[N,K]): f32[N] { y[i] = sum(k) x[i,k]; return y; }';
const kernels = source => source.match(/__global__ void kernel\d+/g) ?? [];

test('CUDA source selects a function, uses current statements, and preloads kernels', async () => {
  const p = compileTix(`fn g(x: f32[N]): f32[N] { return x; }
    fn f(x: f32[N,K]): f32[N] { main[N,K]: f32[N,K] = x[N,K] * 2;
      cudaMalloc[N] = sum(K) main[N,K]; return cudaMalloc; }`);
  const src = cudaSource(p, 'f');
  assert.equal(src, cudaSource(p, 'f'));
  assert.equal(kernels(src).length, 2);
  assert.equal(kernels(cudaSource(p, 'g')).length, 0);
  assert.ok(src.indexOf('cudaFuncGetAttributes') < src.indexOf('cudaEventRecord(start)'));
  assert.match(src, /launch\(\); CK\(cudaGetLastError\(\)\); CK\(cudaDeviceSynchronize/);
  assert.match(src, /__fmul_rn/);
  assert.ok(!src.includes('cudaMalloc['));
  const opt = optimizeTix(p, ['inline', 'split-sum']);
  assert.ok(opt.steps.every(s => s.accepted));
  const changed = cudaSource(opt.program, 'f');
  assert.equal(kernels(changed).length, 1);
  assert.match(changed, /min\(4LL,/);
  assert.match(changed, /%4LL/);
  assert.equal(changed.match(/for \(I v/g).length, 2);
  assert.throws(() => cudaSource(p, 'missing'), /Unknown function/);
  assert.match((await checkLowering(p, 'missing')).reason, /Unknown function/);
  await assert.rejects(runTixCuda(p, 'g', {}), /Wrong CUDA input names/);
});

test('binary framing preserves raw f32 words and rejects partial or misordered results', () => {
  const fn = compileTix('fn f(x: f32[N], y: f32[N-1]): f32[N] { return x; }').current.value.functions[0];
  const base = Float32Array.of(7, -0, 2 ** -149, 3);
  const inputs = {
    y: { shape: [1], data: Float32Array.of(4) },
    x: { shape: [2], data: base.subarray(1, 3) },
  };
  const bytes = encodeCases(fn, [{ id: 17, inputs }]);
  assert.equal(bytes.toString('ascii', 0, 4), 'TIX1');
  assert.equal(bytes.readBigInt64LE(12), 2n);
  assert.equal(bytes.readBigInt64LE(20), 1n);
  assert.equal(bytes.readUInt32LE(28), 0x80000000);
  assert.equal(bytes.readUInt32LE(32), 1);
  assert.equal(bytes.readFloatLE(36), 4);
  assert.throws(
    () => encodeCases(fn, [{ id: 0, inputs: { ...inputs, y: { shape: [0], data: new Float32Array() } } }]),
    /Inconsistent/,
  );

  const out = Buffer.alloc(36);
  out.write('TIX1');
  out.writeUInt32LE(1, 4);
  out.writeUInt32LE(17, 8);
  out.writeUInt32LE(1, 12);
  out.writeFloatLE(0.125, 16);
  out.writeBigInt64LE(2n, 20);
  out.writeUInt32LE(0x80000000, 28);
  out.writeUInt32LE(0x7fc01234, 32);
  const [decoded] = decodeResults(out, 1, [17], 1);
  assert.deepEqual(decoded.shape, [2]);
  assert.deepEqual([...new Uint32Array(decoded.data.buffer)], [0x80000000, 0x7fc01234]);
  assert.equal(decoded.gpuMs, 0.125);
  assert.throws(() => decodeResults(out, 1, [18], 1), /case id/);
  assert.throws(() => decodeResults(out.subarray(0, -1), 1, [17], 1), /Truncated/);
  assert.throws(() => decodeResults(Buffer.concat([out, Buffer.alloc(1)]), 1, [17], 1), /trailing/);
});

test('checked pass batches cases, replays evidence, and does not cache incomplete batches', async () => {
  const { current } = compileTix(sumSource);
  const engine = cudaEngine({ host: 'fake-engine' });
  let calls = 0;
  const run = async (source, fn, cases) => {
    calls++;
    assert.ok(cases.length > 1);
    assert.ok(cases.some(c => c.inputs.x.shape.includes(0)));
    const records = cases.map(({ inputs }) => {
      const result = evaluate(fn, inputs, 'f32');
      if (source.endsWith('// mutant')) result.data.fill(100);
      return result;
    });
    if (calls === 1) records.pop();
    return { records };
  };
  const check = options => checkCudaPass(current, 'f', { engine, run, ...options });
  assert.match((await check()).reason, /Incomplete CUDA batch/);
  assert.equal((await check()).accepted, true);
  assert.equal((await check()).accepted, true);
  assert.equal(calls, 2);
  const candidate = cudaSource(compileTix(sumSource), 'f') + '// mutant';
  const bad = await check({ candidate });
  assert.equal(bad.accepted, false);
  assert.match(bad.reason, /expected.*\(f64\).*got 100/);
  assert.deepEqual(await check({ candidate }), bad);
  assert.equal(calls, 3);
  assert.equal((await check({ engine: { ...engine, host: 'other-fake-engine' } })).accepted, true);
  assert.equal(calls, 4);
  const oversized = compileTix('fn f(x: f32[4097]): f32[4097] { return x; }');
  const none = await checkCudaPass(oversized.current, 'f', { engine, run });
  assert.equal(none.accepted, false);
  assert.match(none.reason, /No eligible lowering cases/);
  assert.equal(calls, 4);
});
