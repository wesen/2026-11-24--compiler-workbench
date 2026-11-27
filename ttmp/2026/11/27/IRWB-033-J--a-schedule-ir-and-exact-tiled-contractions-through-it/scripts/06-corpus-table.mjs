// 06: the results table (timed). Every corpus program, fused and unfused, 12 interleaved benchmark calls per
// program (A B A B ...), median per side; fused and unfused digests compared in every call. This follows the
// brief's protocol: each call is one warm-up launch plus the median of three CUDA-event intervals, under the
// --timed lock; differences under 5% are noise.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileTix, runTix, runTixCuda } from '../../../../../../dist/tensor/index.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../../../../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const sha = data =>
  createHash('sha256').update(new Uint32Array(data.buffer, data.byteOffset, data.length)).digest('hex');
function inputs(shapes, eps, seed = 20) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const out = {};
  for (const [name, shape] of Object.entries(shapes))
    out[name] = { shape, data: Float32Array.from({ length: shape.reduce((n, d) => n * d, 1) }, () => 2 * rand() - 1) };
  if (eps) for (const t of Object.values(out)) t.data[0] = eps;
  return out;
}
const sizes = {
  matmul: { a: [512, 512], b: [512, 512] },
  softmax: { x: [4096, 1024] },
  layernorm: { x: [4096, 1024], gamma: [1024], beta: [1024], eps: [1] },
  attention: { q: [1024, 64], k: [1024, 64], v: [1024, 64] },
  mlp: { x: [1024, 256], w: [256, 1024], bias: [1024], v: [1024, 256], outBias: [256] },
  conv2d: { x: [8, 16, 64, 64], kernel: [32, 16, 3, 3] },
};
const calls = Number(process.argv[2] ?? 12);
const results = {};
for (const name of Object.keys(sizes)) {
  const program = corpus(name);
  const eps = name === 'layernorm' ? 1e-5 : undefined;
  const data = inputs(sizes[name], eps);
  const host = runTix(program, name, data);
  const fused = [], unfused = [];
  let digestFused = '', digestUnfused = '';
  for (let i = 0; i < calls; i++) {
    if (i % 2 === 0) {
      const result = await runTixCuda(program, name, data, { benchmark: true });
      digestFused = sha(result.data);
      fused.push(result.gpuMs);
      const other = await runTixCuda(program, name, data, { fuse: false, benchmark: true });
      digestUnfused = sha(other.data);
      unfused.push(other.gpuMs);
    } else {
      const other = await runTixCuda(program, name, data, { fuse: false, benchmark: true });
      digestUnfused = sha(other.data);
      unfused.push(other.gpuMs);
      const result = await runTixCuda(program, name, data, { benchmark: true });
      digestFused = sha(result.data);
      fused.push(result.gpuMs);
    }
  }
  const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  results[name] = {
    fused: median(fused), unfused: median(unfused),
    all: { fused, unfused },
    ratio: median(fused) / median(unfused),
    digests: { fused: digestFused === sha(host.data), unfused: digestUnfused === sha(host.data) },
  };
  console.log(
    `${name}: fused ${median(fused).toFixed(4)} unfused ${median(unfused).toFixed(4)} ratio ${results[name].ratio.toFixed(2)} digests ${results[name].digests.fused && results[name].digests.unfused ? 'equal' : 'DIFFER'}`,
  );
}
console.log(JSON.stringify(results, null, 1));
