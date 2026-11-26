import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLowering, compileTix, cudaSource, optimizeTix, runTixCuda } from '../../dist/tensor/index.js';
import { decodeCudaBatch, encodeCudaBatch } from '../../dist/tensor/cuda-remote.js';
import { resultMagic } from '../../dist/tensor/cuda-source.js';

const f = compileTix(`
  fn other(x:f32[N]):f32[N] { return x; }
  fn use(__global__:f32[M,K], b:f32[M,K]):f32[M] {
    p[__global__,j] = __global__[__global__,j] * 2;
    out[i] = sum(j) (p[i,j] + (sum(j) b[i,j]));
    return out;
  }
`);

test('emits only the named function; preloads exactly the kernels it defines', () => {
  const source = cudaSource(f, 'use');
  assert.equal([...source.matchAll(/^__global__ void kernel/gm)].length, 2);
  assert.equal([...source.matchAll(/<<<grid\[\d+\], 128>>>/g)].length, 2);
  assert.equal([...source.matchAll(/CUDA\(cudaFuncGetAttributes/g)].length, 2);
  assert.match(source, /__fmul_rn/);
  assert.match(source, /__fadd_rn/);
  assert.doesNotMatch(source, /\b__global__\[/);
  assert.doesNotMatch(cudaSource(f, 'other'), /^__global__ void/m);
  assert.throws(() => cudaSource(f, 'missing'), /Unknown function/);
  const { program, steps } = optimizeTix(f, ['inline', 'split-sum']);
  assert.ok(steps.every(s => s.accepted));
  assert.notEqual(program.current.revision, f.current.revision);
  const after = cudaSource(program, 'use');
  assert.equal([...after.matchAll(/^__global__ void kernel/gm)].length, 1);
  assert.match(after, /% 4 != 0/);
  assert.match(after, /< 4 \?/);
  assert.equal(source, cudaSource(f, 'use'));
});

test('binary ABI uses only each typed-array view and preserves f32 words', () => {
  const fn = f.current.value.functions[0];
  const data = Float32Array.of(77, -0, 2 ** -149, 88).subarray(1, 3);
  const { bytes, shapes } = encodeCudaBatch(fn, [{ x: { shape: [2], data } }]);
  assert.deepEqual(shapes, [[2]]);
  assert.equal(bytes.length, 24);
  assert.equal(bytes.readBigInt64LE(8), 2n);
  assert.equal(bytes.readUInt32LE(16), 0x80000000);
  assert.equal(bytes.readUInt32LE(20), 1);
  const out = Buffer.alloc(36);
  out.writeUInt32LE(resultMagic, 0);
  out.writeUInt32LE(1, 4); // case count
  out.writeUInt32LE(1, 8); // rank
  out.writeBigInt64LE(2n, 12);
  out.writeUInt32LE(1, 20); // repeat count
  out.writeFloatLE(0.25, 24);
  out.writeUInt32LE(0x80000000, 28);
  out.writeUInt32LE(0x7f800000, 32);
  const [result] = decodeCudaBatch(out, shapes, 1);
  assert.deepEqual(result, { shape: [2], data: Float32Array.of(-0, Infinity), times: [0.25] });
  assert.throws(() => decodeCudaBatch(out.subarray(0, -1), shapes, 1), /Incomplete/);
  assert.throws(() => decodeCudaBatch(out, [[3]], 1), /shape differs/);
  assert.throws(() => decodeCudaBatch(Buffer.concat([out, Buffer.alloc(1)]), shapes, 1), /Trailing/);
});

test('rejects incompatible input bindings and checks with no eligible case without using the GPU', async () => {
  await assert.rejects(
    runTixCuda(f, 'use', {
      __global__: { shape: [1, 1], data: Float32Array.of(1) },
      b: { shape: [1, 2], data: Float32Array.of(1, 2) },
    }),
    /Inconsistent binding/,
  );
  const fixed = compileTix('fn fixed(x:f32[4097]):f32[4097]{ return x; }');
  const result = await checkLowering(fixed, 'fixed');
  assert.equal(result.accepted, false);
  assert.equal(result.relation, 'tolerance');
  assert.match(result.reason, /No comparable case/);
});
