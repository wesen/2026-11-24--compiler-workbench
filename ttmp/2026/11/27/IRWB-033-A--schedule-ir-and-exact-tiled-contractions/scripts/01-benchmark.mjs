import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { compileTix, cudaSource, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { selectFunction, value } from '../../../../../../dist/tensor/model.js';

const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  large: { M: 4096, K: 4096, N: 4096 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
const [mode, ...requested] = process.argv.slice(2);
const out = new URL('./out/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const key of requested.length ? requested : Object.keys(sizes)) {
  const name = key === 'large' ? 'matmul' : key;
  const program = compileTix(readFileSync('corpus/tensor/' + name + '/main.tix', 'utf8'));
  const fn = selectFunction(program.current.value, name);
  const path = fuse => new URL('base-' + key + '-' + fuse + '.cu', out);
  if (mode === 'capture') {
    for (const fuse of [true, false]) writeFileSync(path(fuse), cudaSource(program, name, { fuse }));
    continue;
  }
  const dimensions = new Map(Object.entries(sizes[key]));
  let seed = 20;
  const inputs = Object.fromEntries(fn.params.map(p => {
    const shape = p.shape.map(d => value(d, dimensions));
    const data = new Float32Array(shape.reduce((a, b) => a * b, 1));
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      data[i] = p.name === 'eps' ? 1e-5 : (seed / 2 ** 32 - 0.5) * 0.2;
    }
    return [p.name, { shape, data }];
  }));
  const digest = result => createHash('sha256').update(Buffer.from(result.data.buffer)).digest('hex');
  const modes = mode === 'base' ? ['fused', 'unfused'] : mode === 'smoke' ? ['fused'] : ['base', 'fused', 'unfused'];
  const rows = Object.fromEntries(modes.map(m => [m, []]));
  let expected;
  for (let i = 0; i < (mode === 'smoke' ? 1 : 5); i++) {
    for (const m of modes) {
      const fuse = m !== 'unfused';
      const benchmark = mode !== 'smoke';
      const result = m === 'base'
        ? (await runCudaBatch(readFileSync(path(true), 'utf8'), fn, [inputs], { benchmark }))[0]
        : await runTixCuda(program, name, inputs, { fuse, benchmark });
      const hash = digest(result);
      if (expected && expected !== hash) throw Error(key + ' output differs for ' + m);
      expected = hash;
      rows[m].push(result.gpuMs);
      console.error(key, i, m, result.gpuMs, result.gates);
    }
  }
  const median = Object.fromEntries(Object.entries(rows).map(([m, samples]) =>
    [m, [...samples].sort((a,b) => a-b)[Math.floor(samples.length / 2)]]));
  console.log(JSON.stringify({ key, shapes: sizes[key], rows, median, hash: expected }));
}
