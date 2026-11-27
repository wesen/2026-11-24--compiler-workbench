// Probe 04: benchmark GPU time for the corpus at the brief's sizes, fused and unfused, from the public API.
// One warm-up launch and the median of three timed runs (`benchmark: true`), under the tool's `--timed` GPU lock.
//
// Run from the worktree root after `npm run build`:
//   node ttmp/2026/11/26/IRWB-029-H--*/scripts/04-benchmark.mjs [program ...]
import { readFileSync } from 'node:fs';

const { compileTix, cudaSource, runTixCuda } = await import(
  new URL('dist/tensor/index.js', `file://${process.cwd()}/`)
);

const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
const wanted = process.argv.slice(2).filter(a => !a.startsWith('--'));

// Seeded f32 words in [-1, 1); gamma and beta around 1, and a positive eps, so layernorm's root stays in range.
function fill(shape, seed, { positive = false } = {}) {
  let state = seed >>> 0;
  const n = shape.reduce((a, b) => a * b, 1);
  return {
    shape,
    data: Float32Array.from({ length: n }, (_, i) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const v = (state / 2 ** 32) * 2 - 1;
      return positive ? 0.5 + 0.5 * Math.abs(v) : v;
    }),
  };
}

const inputs = name => {
  switch (name) {
    case 'matmul':
      return { a: fill([512, 512], 1), b: fill([512, 512], 2) };
    case 'softmax':
      return { x: fill([4096, 1024], 3) };
    case 'layernorm':
      return {
        x: fill([4096, 1024], 4),
        gamma: fill([1024], 5, { positive: true }),
        beta: fill([1024], 6),
        eps: { shape: [1], data: Float32Array.of(1e-3) },
      };
    case 'attention':
      return { q: fill([1024, 64], 7), k: fill([1024, 64], 8), v: fill([1024, 64], 9) };
    case 'mlp':
      return {
        x: fill([1024, 256], 10),
        w: fill([256, 1024], 11),
        bias: fill([1024], 12),
        v: fill([1024, 256], 13),
        outBias: fill([256], 14),
      };
    case 'conv2d':
      return { x: fill([8, 16, 64, 64], 15), kernel: fill([32, 16, 3, 3], 16) };
  }
};

const table = [];
for (const [name, env] of Object.entries(sizes)) {
  if (wanted.length && !wanted.includes(name)) continue;
  const program = compileTix(readFileSync('corpus/tensor/' + name + '/main.tix', 'utf8'));
  const row = { program: name, sizes: env };
  for (const fuse of [true, false]) {
    // Each call is one warm-up launch and the median of three timed intervals; three calls give nine intervals.
    // The GPU is shared, so the spread is reported beside the median.
    const samples = [];
    let kernels = 0;
    for (let i = 0; i < 3; i++) {
      const result = await runTixCuda(program, name, inputs(name), {
        fuse,
        benchmark: i === 0 ? true : true,
      });
      samples.push(result.gpuMs);
      kernels = (cudaSource(program, name, { fuse }).match(/__global__ void/g) ?? []).length;
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const gpuMs = sorted[1];
    row[fuse ? 'fused' : 'unfused'] = { gpuMs, min: sorted[0], max: sorted[2], samples, kernels };
    console.log(
      `${name.padEnd(10)} ${fuse ? 'fused  ' : 'unfused'} kernels=${kernels} gpuMs=${gpuMs.toFixed(4)} [${sorted.map(v => v.toFixed(4)).join(' ')}]`,
    );
  }
  row.speedup = row.unfused.gpuMs / row.fused.gpuMs;
  console.log(`${''.padEnd(10)} speed-up ${row.speedup.toFixed(2)}x`);
  table.push(row);
}
console.log('\nJSON ' + JSON.stringify(table));
