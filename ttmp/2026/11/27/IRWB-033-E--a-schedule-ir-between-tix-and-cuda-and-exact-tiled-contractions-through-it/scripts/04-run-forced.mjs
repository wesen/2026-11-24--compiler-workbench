// IRWB-033-E script 04: run corpus programs on the GB10 with every tile configuration and gate side forced, at
// shapes that are not multiples of a tile, and compare each output with the f32 interpreter (runTix) bit for bit.
// node 04-run-forced.mjs [program ...]
import { readFileSync } from 'node:fs';
import { compileTix, cudaSource, runTix } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { sidesOf } from '../../../../../../dist/tensor/cuda-contract.js';
const root = new URL('../../../../../../', import.meta.url);
const shapes = {
  matmul: { a: [70, 45], b: [45, 131] },
  attention: { q: [67, 35], k: [70, 35], v: [70, 33] },
  mlp: { x: [66, 40], w: [40, 70], bias: [70], v: [70, 37], outBias: [37] },
  conv2d: { x: [2, 5, 9, 12], kernel: [35, 5, 3, 3] },
  softmax: { x: [9, 50] },
  layernorm: { x: [9, 50], gamma: [50], beta: [50], eps: [1] },
};
let seed = 20;
const next = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
const wanted = process.argv.slice(2);
for (const [name, dims] of Object.entries(shapes)) {
  if (wanted.length && !wanted.includes(name)) continue;
  const p = compileTix(readFileSync(new URL(`corpus/tensor/${name}/main.tix`, root), 'utf8'));
  const inputs = Object.fromEntries(
    Object.entries(dims).map(([k, shape]) => [
      k,
      { shape, data: Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, next) },
    ]),
  );
  const expected = runTix(p, name, inputs);
  const source = cudaSource(p, name);
  for (const side of sidesOf(source)) {
    let line;
    try {
      const [got] = await runCudaBatch(source, p.current.value.functions[0], [inputs], side);
      const a = new Uint32Array(expected.data.buffer),
        b = new Uint32Array(got.data.buffer);
      let bad = a.length === b.length ? -1 : 0;
      for (let i = 0; i < a.length && bad < 0; i++) if (a[i] !== b[i]) bad = i;
      line = { name, side, identical: bad < 0, firstDifference: bad, tiles: got.tiles, gates: got.gates };
    } catch (error) {
      line = { name, side, error: String(error.message).slice(0, 1500) };
    }
    console.log(JSON.stringify(line));
  }
}
