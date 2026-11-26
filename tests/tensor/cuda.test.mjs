import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, cudaSource, optimizeTix, runTixCuda } from '../../dist/tensor/index.js';
import { createCudaLowering } from '../../dist/tensor/cuda-pass.js';
import { decodeCudaResults, encodeCudaCases } from '../../dist/tensor/cuda-run.js';
import { evaluate } from '../../dist/tensor/evaluate.js';
import { differentialStats } from '../../dist/framework/contracts/index.js';

const float = (shape, values) => ({ shape, data: Float32Array.from(values) });
const sum = `fn fold(x:f32[M,K]):f32[M] { y[i] = sum(k) x[i,k]; return y; }`;

test('CUDA emission is deterministic, selected, and tracks the current statement list', () => {
  const program = compileTix(`fn keyword(float:f32[M]):f32[M] {
    __global__[float] = float[float] + 2;
    template[i] = __global__[i] * -0.0;
    return template;
  } ${sum}`);
  const source = cudaSource(program, 'keyword');
  assert.equal(source, cudaSource(program, 'keyword'));
  assert.equal((source.match(/__global__ void kernel/g) ?? []).length, 2);
  assert.doesNotMatch(source, /\btemplate\b|__global__\[/);
  assert.match(source, /constexpr unsigned threads = 256/);
  assert.ok(source.lastIndexOf('cudaFuncGetAttributes') < source.indexOf('cudaEventRecord(start)'));
  assert.match(source, /__fadd_rn/);
  assert.match(source, /__fmul_rn/);
  assert.match(source, /__uint_as_float\(0x0u\)/);
  const inlined = optimizeTix(program, ['inline']);
  assert.equal(inlined.steps[0].accepted, true);
  assert.equal((cudaSource(inlined.program, 'keyword').match(/__global__ void kernel/g) ?? []).length, 1);
  const split = optimizeTix(program, ['split-sum']);
  assert.equal(split.steps[0].accepted, true);
  const splitSource = cudaSource(split.program, 'fold');
  assert.match(splitSource, /\/ 4ULL \+ \(.* % 4ULL != 0\)/);
  assert.match(splitSource, /= tix_tail\(/);
  assert.equal((splitSource.match(/for \(U i/g) ?? []).length, 2);
  assert.throws(() => cudaSource(program, 'notFound'), /Unknown function/);
});

test('binary frames retain bits and reject inconsistencies without a remote call', async () => {
  const program = compileTix(sum),
    fn = program.current.value.functions[0];
  const enc = encodeCudaCases(fn, [{ x: float([1, 2], [-0, 2 ** -149]) }]);
  assert.equal(enc.readUInt32LE(24), 0x80000000);
  assert.equal(enc.readUInt32LE(28), 1);
  await assert.rejects(runTixCuda(program, 'fold', { x: float([1, 2], [1]) }), /data type or length/);
  assert.throws(() => encodeCudaCases(fn, [{ x: float([1, 1], [Infinity]) }]), /Nonfinite input/);
  const out = Buffer.alloc(32);
  out.writeUInt32LE(1, 0);
  out.writeUInt32LE(1, 4);
  out.writeBigUInt64LE(2n, 8);
  out.writeDoubleLE(0.5, 16);
  out.writeUInt32LE(0x80000000, 24);
  out.writeUInt32LE(0xff800000, 28);
  assert.deepEqual(decodeCudaResults(out, 1, 1), [{ ...float([2], [-0, -Infinity]), gpuMs: 0.5 }]);
  assert.throws(() => decodeCudaResults(out.subarray(0, 31), 1, 1), /Truncated CUDA payload/);
  assert.throws(() => decodeCudaResults(Buffer.concat([out, Buffer.of(0)]), 1, 1), /Unexpected bytes/);
  assert.throws(() => decodeCudaResults(out, 1, 2), /case count/);
});

test('the transformation batches a miss, replays evidence, and discards a failed batch', async () => {
  const program = compileTix(sum);
  const target = { host: 'mock.test', nvcc: '/mock/nvcc' };
  let calls = 0,
    fail = true,
    mutant = false;
  const lower = createCudaLowering(
    async (source, fn, cases) => {
      ++calls;
      assert.ok(cases.length > 1);
      assert.ok(cases.some(c => c.x.shape[1] === 0 && c.x.shape[0] > 0));
      const results = cases.map(c => ({ ...evaluate(fn, c, 'f32'), gpuMs: 0 }));
      if (fail) {
        fail = false;
        return { results: results.slice(1) };
      }
      if (source.includes('// mock mutation')) results.find(r => r.data.length).data[0] += 100;
      return { results };
    },
    fn => cudaSource(program, fn.name) + (mutant ? '\n// mock mutation' : ''),
  );
  const result1 = await lower(program, 'fold', target);
  assert.equal(result1.accepted, false);
  assert.match(result1.reason, /Incomplete CUDA batch/);
  const result2 = await lower(program, 'fold', target);
  assert.equal(result2.accepted, true, result2.reason);
  assert.equal(calls, 2);
  const before = differentialStats().replayed;
  assert.deepEqual(await lower(program, 'fold', target), result2);
  assert.equal(differentialStats().replayed - before, result2.evidence.total);
  assert.equal(calls, 2);
  mutant = true;
  const result3 = await lower(program, 'fold', target);
  assert.equal(result3.accepted, false);
  assert.match(result3.reason, /bindings.*at \[0\].*allowed/);
  assert.equal(calls, 3);
});
