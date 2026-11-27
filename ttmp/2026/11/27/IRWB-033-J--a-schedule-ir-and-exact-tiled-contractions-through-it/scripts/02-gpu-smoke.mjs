// 02: GPU smoke (short, untimed): matmul tiled and attention with the k tile, bit-identical to the f32 meaning
// at full size, then their exact checks. This is the first GPU run of the tiled kernels.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileTix, runTix, runTixCuda, checkLowering } from '../../../../../../dist/tensor/index.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../../../../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const sha = data => createHash('sha256').update(new Uint32Array(data.buffer, data.byteOffset, data.length)).digest('hex');

function inputs(shapes, seed = 20) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const out = {};
  for (const [name, shape] of Object.entries(shapes))
    out[name] = {
      shape,
      data: Float32Array.from({ length: shape.reduce((n, d) => n * d, 1) }, () => 2 * rand() - 1),
    };
  return out;
}

const matmul = corpus('matmul');
const m512 = { a: [512, 512], b: [512, 512] };
for (const K of [512]) {
  const shapes = { a: [512, K], b: [K, 512] };
  const host = runTix(matmul, 'matmul', inputs(shapes));
  const gpu = await runTixCuda(matmul, 'matmul', inputs(shapes));
  console.log(`matmul ${K}: gpu ${gpu.gpuMs} ms, digest ${sha(gpu.data) === sha(host.data) ? 'equal' : 'DIFFER'}`);
}
// small and odd shapes, including K = 1 and non-multiples of the tile
for (const [M, K, N] of [[1, 1, 1], [3, 1, 7], [65, 33, 17], [64, 32, 64], [128, 3, 5], [2, 300, 4]]) {
  const shapes = { a: [M, K], b: [K, N] };
  const host = runTix(matmul, 'matmul', inputs(shapes));
  const gpu = await runTixCuda(matmul, 'matmul', inputs(shapes));
  const ok = sha(gpu.data) === sha(host.data) && gpu.gpuMs >= 0;
  console.log(`matmul ${M}x${K}x${N}: ${ok ? 'equal' : 'DIFFER'} (${gpu.gpuMs} ms)`);
}
// attention with its staged k tile
const attention = corpus('attention');
const at = { q: [1024, 64], k: [1024, 64], v: [1024, 64] };
{
  const host = runTix(attention, 'attention', inputs(at));
  const gpu = await runTixCuda(attention, 'attention', inputs(at));
  console.log(`attention 1024x64: gpu ${gpu.gpuMs} ms, digest ${sha(gpu.data) === sha(host.data) ? 'equal' : 'DIFFER'}`);
  const gpuOld = await runTixCuda(attention, 'attention', inputs(at), { fuse: false });
  console.log(`attention unfused: ${gpuOld.gpuMs} ms, digest ${sha(gpuOld.data) === sha(host.data) ? 'equal' : 'DIFFER'}`);
}
// a shape where attention's rows do not fit shared memory (scratch mode with tiles)
{
  const big = { q: [3, 30000], k: [3, 30000], v: [3, 64] };
  const host = runTix(attention, 'attention', inputs(big));
  const gpu = await runTixCuda(attention, 'attention', inputs(big));
  console.log(`attention scratch rows: ${sha(gpu.data) === sha(host.data) ? 'equal' : 'DIFFER'} (${gpu.gpuMs} ms)`);
}
// the exact checks
for (const [name, fn] of [['matmul', 'matmul'], ['attention', 'attention'], ['mlp', 'mlp'], ['softmax', 'softmax']]) {
  const verdict = await checkLowering(corpus(name), fn);
  console.log(`checkLowering ${name} fused: ${verdict.accepted} ${verdict.reason ?? ''}`);
  const unfused = await checkLowering(corpus(name), fn, { fuse: false });
  console.log(`checkLowering ${name} unfused: ${unfused.accepted} ${unfused.reason ?? ''}`);
}
