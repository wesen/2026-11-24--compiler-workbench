import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLowering, compileTix, cudaSource, optimizeTix } from '../../dist/tensor/index.js';
import { encodeCases, decodeResults } from '../../dist/tensor/cuda-io.js';
import { inputMagic, resultMagic, protocolVersion } from '../../dist/tensor/cuda-source.js';

test('CUDA source follows the chosen function and its executable revision', () => {
  const program = compileTix(`
    fn other(x: f32[N]): f32[N] { return x; }
    fn choose(x: f32[N,K]): f32[N] {
      p[i,k] = x[i,k] + 0.125;
      y[i] = sum(k) p[i,k];
      return y;
    }
  `);
  const source = cudaSource(program, 'choose');
  assert.equal(source, cudaSource(program, 'choose'));
  assert.equal(source.match(/__global__ void statement/g).length, 2);
  assert.equal(cudaSource(program, 'other').match(/__global__ void statement/g), null);
  assert.match(source, /__uint_as_float\(0x3e000000U\)/);
  assert.match(source, /cudaFuncGetAttributes/);
  assert.ok(source.indexOf('cudaFuncGetAttributes') < source.indexOf('cudaEventRecord(start)'));
  const optimized = optimizeTix(program, ['inline', 'split-sum']).program;
  assert.notEqual(optimized.current.revision, program.current.revision);
  const lowered = cudaSource(optimized, 'choose');
  assert.equal(lowered.match(/__global__ void statement/g).length, 1);
  assert.match(lowered, /% 4LL != 0/);
  assert.match(lowered, /min\(4LL,/);
});

test('CUDA binary protocol follows parameter order and keeps signed zeros', () => {
  const program = compileTix('fn pair(left:f32[N], right:f32[N]):f32[N] { return left; }');
  const [fn] = program.current.value.functions;
  const bytes = encodeCases(fn, [
    {
      right: { shape: [2], data: Float32Array.of(1, 3) },
      left: { shape: [2], data: Float32Array.of(-0, 2) },
    },
  ]);
  assert.equal(bytes.readUInt32LE(), inputMagic);
  assert.equal(bytes.readUInt32LE(4), protocolVersion);
  assert.equal(bytes.readUInt32LE(8), 1);
  assert.equal(bytes.readBigUInt64LE(12), 2n);
  assert.equal(bytes.readUInt32LE(20), 0x80000000);
  assert.equal(bytes.readFloatLE(24), 2);
  assert.equal(bytes.readFloatLE(36), 1);
  const result = Buffer.alloc(32);
  result.writeUInt32LE(resultMagic);
  result.writeUInt32LE(protocolVersion, 4);
  result.writeUInt32LE(1, 8);
  result.writeBigUInt64LE(2n, 12);
  result.writeFloatLE(0.25, 20);
  result.writeUInt32LE(0x80000000, 24);
  result.writeFloatLE(6, 28);
  const [output] = decodeResults(result, 1, 1, 1);
  assert.deepEqual(output.shape, [2]);
  assert.deepEqual([...output.data], [-0, 6]);
  assert.equal(output.gpuMs, 0.25);
  assert.throws(() => decodeResults(result.subarray(0, -1), 1, 1, 1), /Truncated/);
  assert.throws(() => decodeResults(Buffer.concat([result, Buffer.alloc(1)]), 1, 1, 1), /Trailing/);
});

test('CUDA check requires an eligible f64 reference', async () => {
  const program = compileTix('fn large(x:f32[4097]):f32[4097] { return x; }');
  assert.deepEqual(await checkLowering(program, 'large'), {
    accepted: false,
    relation: 'tolerance',
    reason: 'No comparable case for large',
  });
});
