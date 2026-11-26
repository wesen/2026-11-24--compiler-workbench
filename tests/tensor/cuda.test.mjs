import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, cudaSource, optimizeTix } from '../../dist/tensor/index.js';
import { loweringChecker } from '../../dist/tensor/cuda-contract.js';
import { encodeBatch, decodeBatch } from '../../dist/tensor/cuda-run.js';
import { evaluate } from '../../dist/tensor/evaluate.js';

const p = compileTix(`fn f(x:f32[N]):f32[N]{ float[x]=x[x]+1; y[j]=float[j]/N; return y; }
 fn g(x:f32[N]):f32[N]{return x;}`);
test('source is deterministic, scoped to the current function and handles C keyword collisions', () => {
  const src = cudaSource(p, 'f');
  assert.equal(src, cudaSource(p, 'f'));
  assert.equal(src.match(/__global__ void/g).length, 2);
  assert.match(src, /0x3f800000u/);
  assert.match(src, /__fdiv_rn/);
  assert.doesNotMatch(cudaSource(p, 'g'), /__global__ void/);
  assert.equal(cudaSource(optimizeTix(p, ['inline']).program, 'f').match(/__global__ void/g).length, 1);
  assert.throws(() => cudaSource(p, 'no-such-function'), /Unknown/);
});

test('input codec serializes parameter order and byte offsets, rejects inconsistent binding', () => {
  const fn = compileTix('fn f(a:f32[N],b:f32[N]):f32[N]{return b;}').current.value.functions[0];
  const b = { shape: [2], data: Float32Array.from([9, -0, 12, 10]).subarray(1, 3) },
    a = { shape: [2], data: Float32Array.of(4, 5) };
  const { bytes, shapes } = encodeBatch(fn, [{ b, a }]);
  assert.deepEqual(shapes, [[2]]);
  assert.equal(bytes.readFloatLE(24), 4);
  assert.equal(bytes.readFloatLE(44), -0);
  assert.throws(() => encodeBatch(fn, [{ a, b: { shape: [1], data: Float32Array.of(2) } }]), /shape/);
});

test('result codec preserves f32 words, rejects extra/missing/invalid records', () => {
  const b = Buffer.alloc(32);
  b.write('TXO1');
  b.writeUInt32LE(1, 4);
  b.writeUInt32LE(1, 12);
  b.writeBigInt64LE(1n, 16);
  b.writeFloatLE(-0, 24);
  b.writeFloatLE(0.125, 28);
  const [result] = decodeBatch(b, [[1]]);
  assert.equal(result.data[0], -0);
  assert.equal(result.gpuMs, 0.125);
  for (const bad of [Buffer.concat([b, Buffer.of(0)]), b.subarray(0, 31)])
    assert.throws(() => decodeBatch(bad, [[1]]));
  assert.throws(() => decodeBatch(b, [[2]]), /shape/);
  b.writeFloatLE(NaN, 28);
  assert.throws(() => decodeBatch(b, [[1]]), /event/);
});

test('gate delegates one batch, retries incomplete batches, replays only corresponding evidence', async () => {
  let calls = 0,
    incomplete = true;
  const gate = loweringChecker('test.cuda.mock', (fn, src, batch) => {
    calls++;
    assert.ok(batch.length > 2);
    if (incomplete) return Promise.resolve([]);
    return Promise.resolve(
      batch.map(inputs => {
        const out = evaluate(fn, inputs, 'f32');
        if (src === 'bad') out.data.fill(123);
        return { ...out, gpuMs: 0 };
      }),
    );
  });
  assert.match((await gate(p, 'f', 'good')).reason, /Incomplete/);
  incomplete = false;
  assert.equal((await gate(p, 'f', 'good')).accepted, true);
  assert.equal((await gate(p, 'f', 'good')).accepted, true);
  assert.equal(calls, 2);
  const bad = await gate(p, 'f', 'bad');
  assert.equal(bad.accepted, false);
  assert.match(bad.reason, /at \[.*expected/);
  assert.equal(calls, 3);
  assert.equal((await gate(p, 'g', 'good')).accepted, true);
  assert.equal(calls, 4);
  const opt = optimizeTix(p, ['inline']).program;
  assert.equal((await gate(opt, 'f', 'good')).accepted, true);
  assert.equal(calls, 5);
});

test('no evidence when only artificial empty returns would be comparable', async () => {
  const invalid = compileTix('fn f(x:f32[N]):f32[N]{y[i]=sqrt(-1)+x[i];return y;}');
  const gate = loweringChecker('test.cuda.empty', () => {
    throw Error('Should not delegate');
  });
  const verdict = await gate(invalid, 'f', 'source');
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /no decided case/);
});
