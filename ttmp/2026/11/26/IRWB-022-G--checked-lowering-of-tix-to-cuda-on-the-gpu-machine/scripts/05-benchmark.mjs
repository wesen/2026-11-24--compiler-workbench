// Run from repo root: node <this file> cpu|gpu|compare <scratch-dir> (compare last).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const load = p => import(pathToFileURL(resolve('dist', p)));
const { compileTix, runTix, cudaSource } = await load('tensor/index.js');
const { seededRandom } = await load('framework/contracts/index.js');
const { value } = await load('tensor/model.js');
const sizes = {
  matmul: { M: 512, N: 512, K: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
for (const [name, dims] of Object.entries(sizes)) {
  const p = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8')),
    fn = p.current.value.functions[0];
  function inputs(small) {
    const rng = seededRandom(22),
      env = new Map(Object.entries(dims).map(([k, n]) => [k, small ? 4 : n]));
    return Object.fromEntries(
      fn.params.map(t => {
        const shape = t.shape.map(a => value(a, env));
        return [
          t.name,
          {
            shape,
            data: Float32Array.from({ length: shape.reduce((a, b) => a * b) }, () =>
              t.name === 'eps' ? 0.0001 : rng() * 0.5 - 0.25,
            ),
          },
        ];
      }),
    );
  }
  const args = inputs(false),
    path = join(process.argv[3], name + '.f32');
  const h = createHash('sha256');
  for (const t of Object.values(args)) h.update(Buffer.from(t.data.buffer));
  const meta = { name, inputs: h.digest('hex') };
  if (process.argv[2] === 'cpu') {
    runTix(p, name, inputs(true));
    const start = performance.now();
    const { shape, data } = runTix(p, name, args);
    const cpuMs = performance.now() - start;
    writeFileSync(path, Buffer.from(data.buffer));
    console.log(JSON.stringify({ ...meta, shape, cpuMs }));
  } else if (process.argv[2] === 'gpu') {
    const { runBatch } = await load('tensor/cuda-run.js');
    const { results, stdout } = await runBatch(
      cudaSource(p, name),
      fn,
      [{ id: 0, inputs: args }],
      undefined,
      true,
    );
    const [{ shape, data, gpuMs }] = results;
    writeFileSync(path + '.gpu', Buffer.from(data.buffer));
    console.log(JSON.stringify({ ...meta, shape, gpuMs, stdout: stdout.trim() }));
  } else if (process.argv[2] === 'compare') {
    const gpu = readFileSync(path + '.gpu'),
      bytes = readFileSync(path);
    const data = new Float32Array(gpu.buffer, gpu.byteOffset, gpu.length / 4);
    let maxAbs = 0;
    if (bytes.length !== data.byteLength) throw Error('length');
    for (let i = 0; i < data.length; i++)
      maxAbs = Math.max(maxAbs, Math.abs(data[i] - bytes.readFloatLE(i * 4)));
    if (!Number.isFinite(maxAbs)) throw Error('nonfinite');
    console.log(JSON.stringify({ ...meta, maxAbs }));
  } else throw Error('expected cpu, gpu or compare');
}
