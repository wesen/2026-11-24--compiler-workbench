import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLowering, compileTix, cudaSource, runTixCuda } from '../../dist/tensor/index.js';
import {
  CudaIR,
  cudaArtifact,
  createCudaLowering,
  kernelCorrespondence,
} from '../../dist/tensor/cuda-contract.js';
import { decodeCudaCases, encodeCudaCases } from '../../dist/tensor/cuda-runtime.js';
import { evaluate } from '../../dist/tensor/evaluate.js';

const buf = (shape, values) => ({ shape, data: Float32Array.from(values) });
const p = compileTix('fn f(x:f32[N,K]):f32[N] { y[i] = sum(k) x[i,k]; return y; }');
const fn = p.current.value.functions[0];

test('CUDA source is deterministic and preloads every emitted statement kernel before timing', () => {
  assert.equal(typeof checkLowering, 'function');
  assert.equal(typeof runTixCuda, 'function');
  const program = compileTix(
    'fn first(x:f32[N]):f32[N] { return x; } fn second(x:f32[N]):f32[N] { y[i]=exp(x[i]); z[i]=y[i]*x[i]; return z; }',
  );
  // stage 2 (fuse: false) is one kernel per statement; the fused default computes both in one (IRWB-029-D)
  const source = cudaSource(program, 'second', { fuse: false });
  assert.equal(source, cudaSource(program, 'second', { fuse: false }));
  assert.equal((source.match(/__global__ void/g) ?? []).length, 2);
  assert.ok(
    source.indexOf('cudaFuncGetAttributes(&attributes, k1)') < source.indexOf('gpu_ms = time_kernels'),
  );
  assert.match(source, /__double2float_rn\(exp/);
  const fused = cudaSource(program, 'second');
  assert.equal(fused, cudaSource(program, 'second'));
  assert.equal((fused.match(/__global__ void/g) ?? []).length, 1);
  assert.ok(fused.indexOf('cudaFuncGetAttributes(&attributes, k0)') < fused.indexOf('gpu_ms = time_kernels'));
  assert.match(fused, /__double2float_rn\(exp/);
  assert.doesNotMatch(cudaSource(program, 'first'), /__global__ void/);
});

test('CUDA binary requests and results preserve f32 words, including subarray and zero shape', () => {
  const a = Float32Array.of(9, -0, 2 ** -149, 99);
  const request = encodeCudaCases(fn, [
    { x: { shape: [1, 2], data: a.subarray(1, 3) } },
    { x: buf([3, 0], []) },
  ]);
  assert.equal(request.toString('ascii', 0, 8), 'TIXCUDA1');
  assert.deepEqual(
    [8, 16, 24, 40, 48].map(i => request.readBigUInt64LE(i)),
    [2n, 1n, 2n, 3n, 0n],
  );
  assert.deepEqual([request.readUInt32LE(32), request.readUInt32LE(36)], [0x80000000, 1]);
  assert.throws(() => encodeCudaCases(fn, [{ x: buf([2, 2], [1]) }]), /shape or length/);

  const response = Buffer.alloc(16 + 8 + 4 + 8 + 8 + 8);
  response.write('TIXCUDA1');
  response.writeBigUInt64LE(2n, 8);
  response.writeBigUInt64LE(1n, 16);
  response.writeUInt32LE(0x80000000, 24);
  response.writeDoubleLE(0.03125, 28);
  assert.deepEqual(decodeCudaCases(response, 2, 1), [
    { ...buf([1], [-0]), gpuMs: 0.03125 },
    { ...buf([0], []), gpuMs: 0 },
  ]);
  assert.throws(() => decodeCudaCases(response.subarray(0, -1), 2, 1), /Short/);
  assert.throws(() => decodeCudaCases(response, 1, 1), /case count/);
});

test('concurrent lowering checks share a batch, retry transport failures and replay verdicts', async () => {
  const batches = [];
  let fail = true;
  const engine = async (source, f, cases) => {
    batches.push(cases);
    await new Promise(resolve => setImmediate(resolve));
    if (fail) {
      fail = false;
      throw Error('simulated transport failure');
    }
    return cases.map(inputs => {
      const result = evaluate(f, inputs, 'f32');
      if (source === 'different CUDA source' && result.data.length) result.data[0] += 1;
      return { ...result, gpuMs: 0 };
    });
  };
  const check = createCudaLowering('tensor-test-engine-1', engine);
  const pair = () => Promise.all([check(p.current, 'f'), check(p.current, 'f')]);
  const [first, other] = await pair();
  assert.equal(batches.length, 1);
  assert.equal(first.accepted, false);
  assert.match(first.reason, /simulated transport failure/);
  assert.deepEqual(other, first);
  const accepted = { accepted: true, relation: 'exact' };
  assert.deepEqual(await pair(), [accepted, accepted]);
  assert.deepEqual(await check(p.current, 'f'), { accepted: true, relation: 'exact' });
  assert.equal(batches.length, 2);
  assert.ok(batches[1].length > 1);
  assert.ok(batches[1].some(c => c.x.shape[0] > 0 && c.x.shape[1] === 0));

  const changed = cudaArtifact('f', 'different CUDA source');
  const rejected = await check(p.current, 'f', changed);
  assert.equal(rejected.accepted, false);
  assert.match(rejected.reason, /At \[0\], expected/);
  assert.deepEqual(await check(p.current, 'f', changed), rejected);
  assert.equal(batches.length, 3);
  assert.equal((await createCudaLowering('tensor-test-engine-2', engine)(p.current, 'f')).accepted, true);
  assert.equal(batches.length, 4);
});

test('the lowering relation is exact: one ulp is rejected, a different NaN word is not (IRWB-019 F17)', async () => {
  const nudge = (data, step) => {
    const w = new Uint32Array(data.buffer, data.byteOffset, data.length);
    for (let i = 0; i < w.length; i++)
      if (Number.isFinite(data[i]) && data[i] !== 0) {
        w[i] += step;
        return;
      }
  };
  const engine = mode => async (_source, f, cases) =>
    cases.map(inputs => {
      const result = evaluate(f, inputs, 'f32');
      if (mode === 'ulp') nudge(result.data, 1);
      if (mode === 'nan') {
        const w = new Uint32Array(result.data.buffer, result.data.byteOffset, result.data.length);
        for (let i = 0; i < w.length; i++) if (Number.isNaN(result.data[i])) w[i] = 0x7fffffff;
      }
      return { ...result, gpuMs: 0 };
    });
  const ulp = await createCudaLowering('tensor-test-ulp', engine('ulp'))(p.current, 'f');
  assert.equal(ulp.accepted, false);
  assert.equal(ulp.relation, 'exact');
  assert.match(ulp.reason, /expected .* \(0x[0-9a-f]{8}\), got .* \(0x[0-9a-f]{8}\)/);
  const nan = compileTix('fn g(x:f32[N]):f32[N]{y[i]=sqrt(x[i]-2);return y;}');
  assert.deepEqual(await createCudaLowering('tensor-test-nan', engine('nan'))(nan.current, 'g'), {
    accepted: true,
    relation: 'exact',
  });
});

test('lowering rejects statement IDs absent from the Tix artifact', async () => {
  const engine = async (_source, f, cases) =>
    cases.map(inputs => ({ ...evaluate(f, inputs, 'f32'), gpuMs: 0 }));
  const check = createCudaLowering('entity-test', engine);
  const candidate = cudaArtifact('f', 'source', [{ name: 'k0', mapping: 'thread', statements: ['missing'] }]);
  const result = await check(p.current, 'f', candidate);
  assert.equal(result.accepted, false);
  assert.match(result.reason, /missing/);
});

test('kernel inventories reject invented and omitted CUDA kernels', async () => {
  const { AnalysisManager, defineTransformation } = await import('../../dist/framework/contracts/index.js');
  const { TixIR } = await import('../../dist/tensor/ir.js');
  const subject = cudaArtifact('f', 'source', [{ name: 'k0', mapping: 'thread', statements: ['y'] }]);
  const pass = defineTransformation({
    id: 'test.kernel-inventory',
    version: '1',
    description: 'kernel correspondence',
    inputs: { baseline: TixIR },
    outputs: { subject: CudaIR },
    correspondence: [{ id: 'kernels', from: 'baseline', to: 'subject' }],
  });
  const correspondence = kernelCorrespondence(p.current, subject);
  for (const targetEntities of [[], ['k0', 'invented']])
    await assert.rejects(
      new AnalysisManager().verifyTransformation({ baseline: p.current }, { subject }, pass, [
        { ...correspondence, targetEntities },
      ]),
      /entity mismatch/,
    );
});

test('every corpus lowering validates fused and unfused without a GPU', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const engine = async (_source, f, cases) =>
    cases.map(inputs => ({ ...evaluate(f, inputs, 'f32'), gpuMs: 0 }));
  const check = createCudaLowering('corpus-local', engine);
  for (const name of readdirSync(new URL('../../corpus/tensor/', import.meta.url))) {
    const program = compileTix(
      readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'),
    );
    for (const fn of program.current.value.functions)
      for (const fuse of [true, false]) {
        const result = await check(program.current, fn.name, undefined, { fuse });
        assert.equal(result.accepted, true, `${name}/${fn.name} fuse=${fuse}: ${result.reason}`);
      }
  }
});
