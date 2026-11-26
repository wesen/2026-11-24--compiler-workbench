import assert from 'node:assert/strict';
import test from 'node:test';
import { compileTix, optimizeTix, cudaSource, checkLowering, runTixCuda } from '../../dist/tensor/index.js';
import { encodeCases, decodeResults } from '../../dist/tensor/cuda-run.js';

test('source selects the executable revision and numbers binders independently of Tix names', () => {
  assert.equal(typeof runTixCuda, 'function');
  const program = compileTix(
    'fn f(for:f32[N,K]):f32[N] { tmp[i,k]=for[i,k]*2; y[i]=sum(k) tmp[i,k]; return y; }',
  );
  const optimized = optimizeTix(program, ['inline', 'split-sum']);
  assert.ok(optimized.steps.every(s => s.accepted));
  const source = cudaSource(optimized.program, 'f');
  assert.equal((cudaSource(program, 'f').match(/__global__ void kernel/g) ?? []).length, 2);
  assert.equal(source.match(/__global__ void kernel/g).length, 1);
  assert.equal(source.match(/for \(Index i/g).length, 2);
  assert.match(source, /int main\(\)/);
  assert.equal(cudaSource(optimized.program, 'f'), source);
});

test('wire records preserve offsets, signed zeros, shape and the chosen timing mode', () => {
  const fn = compileTix('fn f(x:f32[N]):f32[N]{return x;}').current.value.functions[0];
  const cases = [
    { id: 17, inputs: { x: { shape: [2], data: Float32Array.of(5, -0, -3, 8).subarray(1, 3) } } },
  ];
  const input = encodeCases(fn, cases, 1);
  assert.equal(input.length, 32);
  assert.equal(input.readUInt32LE(8), 1);
  assert.equal(input.readBigUInt64LE(16), 2n);
  assert.equal(input.readUInt32LE(24), 0x80000000);
  assert.equal(input.readFloatLE(28), -3);
  const result = Buffer.alloc(40);
  input.copy(result, 0, 0, 16);
  result.writeUInt32LE(1, 16);
  result.writeBigUInt64LE(2n, 20);
  result.writeFloatLE(0.25, 28);
  input.copy(result, 32, 24);
  assert.deepEqual(decodeResults(result, fn, cases, 1), [
    { shape: [2], times: [0.25], data: Float32Array.of(-0, -3) },
  ]);
  assert.throws(() => decodeResults(result.subarray(0, 39), fn, cases, 1), /Incomplete/);
  result.writeUInt32LE(7, 12);
  assert.throws(() => decodeResults(result, fn, cases, 1), /ID/);
});

test('no eligible origin case cannot authorize a lowering', async () => {
  const program = compileTix('fn large(x:f32[5000]):f32[5000]{return x;}');
  const check = await checkLowering(program, 'large');
  assert.equal(check.accepted, false);
  assert.equal(check.relation, 'tolerance');
  assert.match(check.reason, /large.*no decided case/);
});
