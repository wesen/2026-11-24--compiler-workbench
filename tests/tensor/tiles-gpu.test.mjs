// IRWB-033-J: GB10 checks of the tiled lowerings. This file needs the GPU machine; the others do not.
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkCudaLowering, cudaArtifact } from '../../dist/tensor/cuda-contract.js';
import { emitCuda } from '../../dist/tensor/cuda-source.js';
import { scheduleTixFn, defaultTileParams } from '../../dist/tensor/schedule.js';
import { runCudaBatch } from '../../dist/tensor/cuda-runtime.js';
import { compileTix, runTix, runTixCuda } from '../../dist/tensor/index.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const sha = data =>
  createHash('sha256').update(new Uint32Array(data.buffer, data.byteOffset, data.length)).digest('hex');
function inputs(shapes, seed = 20) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const out = {};
  for (const [name, shape] of Object.entries(shapes))
    out[name] = { shape, data: Float32Array.from({ length: shape.reduce((n, d) => n * d, 1) }, () => 2 * rand() - 1) };
  return out;
}

test('matmul: the tiled kernel is exact at full size and at odd, empty and single-index shapes', async () => {
  const program = corpus('matmul');
  const host = inputs({ a: [512, 512], b: [512, 512] });
  const reference = runTix(program, 'matmul', host);
  const tiled = await runTixCuda(program, 'matmul', host, { benchmark: true });
  assert.equal(sha(tiled.data), sha(reference.data));
  const stage2 = await runTixCuda(program, 'matmul', host, { fuse: false });
  assert.equal(sha(stage2.data), sha(reference.data));
  assert.ok(tiled.gpuMs < stage2.gpuMs, `tiled ${tiled.gpuMs} should be faster than stage 2 ${stage2.gpuMs}`);
  for (const [m, k, n] of [[1, 1, 1], [3, 1, 7], [65, 33, 17], [128, 3, 5], [2, 300, 4], [0, 5, 4], [5, 0, 4], [5, 4, 0], [64, 64, 64], [63, 65, 67]]) {
    const shapes = { a: [m, k], b: [k, n] };
    const small = inputs(shapes);
    const want = runTix(program, 'matmul', small);
    const got = await runTixCuda(program, 'matmul', small);
    assert.equal(sha(got.data), sha(want.data), `matmul ${m}x${k}x${n}`);
  }
});

test('matmul: the exact contract accepts the tiled lowering, fused and unfused, and rejects a mutated tile', async () => {
  const program = corpus('matmul');
  const fused = await checkLowering(program, 'matmul');
  assert.equal(fused.accepted, true, fused.reason);
  const unfused = await checkLowering(program, 'matmul', { fuse: false });
  assert.equal(unfused.accepted, true, unfused.reason);
  // a mutant that swaps one patch element's staged operand: the differential must name a coordinate
  const f = program.current.value.functions.find(x => x.name === 'matmul');
  const source = emitCuda(f, scheduleTixFn(f).schedule.value);
  const mutant = source.replace('__fmul_rn(ar0, br1)', '__fmul_rn(ar0, br0)');
  assert.match(source, /__fmul_rn\(ar0, br1\)/);
  const verdict = await checkCudaLowering(
    program.current,
    'matmul',
    cudaArtifact('matmul', mutant, [{ name: 'k0', mapping: 'gemm', statements: ['y'] }]),
  );
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /expected .*\(0x[0-9a-f]{8}\), got .*\(0x[0-9a-f]{8}\)/);
});

test('a contraction with an epilogue and a rank-1 output tiles and stays exact', async () => {
  const program = compileTix(
    `fn biasmul(x:f32[M,K], w:f32[K,N], b:f32[N]):f32[M,N] {
       y[i,j] = (sum(k) x[i,k] * w[k,j]) + b[j];
       return y;
     }
     fn vecdot(x:f32[K], w:f32[K,N]):f32[N] {
       y[j] = sum(k) x[k] * w[k,j];
       return y;
     }`,
  );
  for (const [fn, shapes] of [
    ['biasmul', { x: [37, 129], w: [129, 5], b: [5] }],
    ['vecdot', { x: [129], w: [129, 5] }],
  ]) {
    const data = inputs(shapes);
    const reference = runTix(program, fn, data);
    const got = await runTixCuda(program, fn, data);
    assert.equal(sha(got.data), sha(reference.data), fn);
    const verdict = await checkLowering(program, fn);
    assert.equal(verdict.accepted, true, verdict.reason);
  }
});

test('the operand tile for a block-mode member is exact, including in scratch mode and behind the gate', async () => {
  const program = corpus('attention');
  const f = program.current.value.functions.find(x => x.name === 'attention');
  // force the member tile on (the shipped rule leaves it off): schedule, emit and run directly
  const { schedule } = scheduleTixFn(f, {
    tile: { gemm: defaultTileParams.gemm, member: { chunk: 16, pad: 1 } },
  });
  const source = emitCuda(f, schedule.value);
  assert.match(source, /float\* const op3 = tiles/);
  for (const [label, shapes] of [
    ['small', { q: [3, 200], k: [200, 17], v: [200, 31] }],
    ['row > shared', { q: [2, 30000], k: [3, 30000], v: [3, 64] }],
  ]) {
    const data = inputs(shapes);
    const reference = runTix(program, 'attention', data);
    for (const gate of ['fused', 'unfused']) {
      const [result] = await runCudaBatch(source, f, [data], { gate });
      assert.equal(sha(result.data), sha(reference.data), `${label} ${gate}`);
    }
  }
  // at the brief's size the fused side is exact too
  const data = inputs({ q: [1024, 64], k: [1024, 64], v: [1024, 64] });
  const reference = runTix(program, 'attention', data);
  const [fused] = await runCudaBatch(source, f, [data], { gate: 'fused' });
  assert.equal(sha(fused.data), sha(reference.data));
});

test('every corpus program accepts under the exact contract, fused and unfused', async () => {
  for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
    const program = corpus(name);
    const fused = await checkLowering(program, name);
    assert.equal(fused.accepted, true, `${name} fused: ${fused.reason}`);
    const unfused = await checkLowering(program, name, { fuse: false });
    assert.equal(unfused.accepted, true, `${name} unfused: ${unfused.reason}`);
  }
});
