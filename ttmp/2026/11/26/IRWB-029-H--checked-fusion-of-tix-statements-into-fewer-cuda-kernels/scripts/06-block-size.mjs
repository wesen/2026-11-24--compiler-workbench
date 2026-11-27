// Probe 06: does the fused row kernel want 256 threads per block?
//
// The block per row mapping makes every reduction over the lane axis one thread's serial fold, so the number of
// resident blocks (not threads) sets how many rows the folds can work on at once: 2048 threads per SM divided by
// the block size, capped at the architecture's blocks per SM. The lane loops stride by blockDim.x, so the block
// size is the only thing that changes here. Patches the launch configuration of the emitted source and runs it
// through the runner with `benchmark: true`.
//
// Run from the worktree root after `npm run build`:
//   node ttmp/2026/11/26/IRWB-029-H--*/scripts/06-block-size.mjs
import { readFileSync } from 'node:fs';

const { compileTix, cudaSource } = await import(new URL('dist/tensor/index.js', `file://${process.cwd()}/`));
const { runCudaBatch } = await import(new URL('dist/tensor/cuda-runtime.js', `file://${process.cwd()}/`));

const fill = (shape, seed, positive = false) => {
  let state = seed >>> 0;
  const n = shape.reduce((a, b) => a * b, 1);
  return {
    shape,
    data: Float32Array.from({ length: n }, () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const v = (state / 2 ** 32) * 2 - 1;
      return positive ? 0.5 + 0.5 * Math.abs(v) : v;
    }),
  };
};

const cases = {
  softmax: { fn: 'softmax', inputs: { x: fill([4096, 1024], 3) } },
  layernorm: {
    fn: 'layernorm',
    inputs: {
      x: fill([4096, 1024], 4),
      gamma: fill([1024], 5, true),
      beta: fill([1024], 6),
      eps: { shape: [1], data: Float32Array.of(1e-3) },
    },
  },
};

for (const [name, { fn, inputs }] of Object.entries(cases)) {
  const program = compileTix(readFileSync('corpus/tensor/' + name + '/main.tix', 'utf8'));
  const source = cudaSource(program, name);
  const launch = source.match(/k0<<<(\(.*?\)), 256, /);
  if (!launch) throw Error('no row launch to patch in ' + name);
  const out = [];
  for (const threads of [64, 128, 128, 256, 256]) {
    const patched = source.replace(`k0<<<${launch[1]}, 256, `, `k0<<<${launch[1]}, ${threads}, `);
    if (patched === source && threads !== 256) throw Error('patch did not apply');
    const [result] = await runCudaBatch(patched, program.current.value.functions[0], [inputs], {
      benchmark: true,
    });
    out.push({ threads, gpuMs: result.gpuMs });
    console.log(`${name.padEnd(10)} threads=${String(threads).padStart(3)} gpuMs=${result.gpuMs.toFixed(4)}`);
  }
  const best = out.reduce((a, b) => (a.gpuMs <= b.gpuMs ? a : b));
  console.log(`${name.padEnd(10)} best ${best.threads} threads at ${best.gpuMs.toFixed(4)} ms`);
}
