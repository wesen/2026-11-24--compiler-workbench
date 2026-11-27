// 05b: the 4096^3 digest comparison that 05 lost to an ssh pipe break: one call per side, digests compared.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileTix, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { emitCuda } from '../../../../../../dist/tensor/cuda-source.js';
import { scheduleTixFn } from '../../../../../../dist/tensor/schedule.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../../../../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
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
const program = corpus('matmul');
const f = program.current.value.functions.find(x => x.name === 'matmul');
const data = inputs({ a: [4096, 4096], b: [4096, 4096] });
const { schedule } = scheduleTixFn(f);
const source = emitCuda(f, schedule.value);
const digests = new Set();
const [tiled] = await runCudaBatch(source, f, [data], { benchmark: true });
digests.add(sha(tiled.data));
console.log(`tiled: ${tiled.gpuMs.toFixed(3)} ms`);
const stage2 = await runTixCuda(program, 'matmul', data, { fuse: false, benchmark: true });
digests.add(sha(stage2.data));
console.log(`stage 2: ${stage2.gpuMs.toFixed(3)} ms`);
console.log(digests.size === 1 ? '4096^3 digests equal (tiled == stage 2, both == the meaning by the contract)' : 'DIGESTS DIFFER');
