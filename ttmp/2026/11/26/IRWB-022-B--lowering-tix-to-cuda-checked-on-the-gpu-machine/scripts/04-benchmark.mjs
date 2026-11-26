import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { arch, cpus } from 'node:os';
import { compileTix, runTix } from '../../../../../../dist/tensor/index.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { value } from '../../../../../../dist/tensor/model.js';

const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
const seed = 20;
function inputsFor(fn, dimensions) {
  const rng = seededRandom(seed);
  const vars = new Map(Object.entries(dimensions));
  return Object.fromEntries(
    fn.params.map(p => {
      const shape = p.shape.map(d => value(d, vars));
      const length = shape.reduce((a, b) => a * b, 1);
      const data = Float32Array.from({ length }, () => (p.name === 'eps' ? 1e-5 : rng() * 0.5 - 0.25));
      return [p.name, { shape, data }];
    }),
  );
}

const [mode, dir] = process.argv.slice(2);
if (!['cpu', 'gpu', 'compare'].includes(mode) || !dir)
  throw Error('usage: 04-benchmark.mjs cpu|gpu|compare scratch-dir');
mkdirSync(dir, { recursive: true });
const { cudaSource, runCudaBatch } =
  mode === 'gpu'
    ? {
        ...(await import('../../../../../../dist/tensor/index.js')),
        ...(await import('../../../../../../dist/tensor/cuda-io.js')),
      }
    : {};
for (const [name, dimensions] of Object.entries(sizes)) {
  const program = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
  const [fn] = program.current.value.functions;
  const inputs = inputsFor(fn, dimensions);
  const path = join(dir, name + '.f32');
  if (mode === 'cpu') {
    const warmDims = Object.fromEntries(Object.keys(dimensions).map(n => [n, 8]));
    runTix(program, name, inputsFor(fn, warmDims));
    const start = performance.now();
    const output = runTix(program, name, inputs);
    const cpuMs = performance.now() - start;
    writeFileSync(path, Buffer.from(output.data.buffer, output.data.byteOffset, output.data.byteLength));
    console.log(
      JSON.stringify({
        name,
        dimensions,
        seed,
        cpuMs,
        node: process.version,
        arch: arch(),
        cpu: cpus()[0].model,
      }),
    );
  } else if (mode === 'gpu') {
    const {
      outputs: [output],
      remote,
    } = await runCudaBatch(fn, cudaSource(program, name), [inputs], {
      timed: true,
      repetitions: 6,
    });
    assert.deepEqual(
      output.shape,
      fn.shape.map(d => value(d, new Map(Object.entries(dimensions)))),
    );
    writeFileSync(
      path + '.gpu',
      Buffer.from(output.data.buffer, output.data.byteOffset, output.data.byteLength),
    );
    console.log(
      JSON.stringify({ name, dimensions, seed, gpuMs: output.gpuMs, samples: output.samples, remote }),
    );
  } else {
    const cpuOutput = readFileSync(path);
    const gpuOutput = readFileSync(path + '.gpu');
    if (cpuOutput.length !== gpuOutput.length) throw Error('CPU/GPU length disagreement');
    let maxAbs = 0;
    for (let i = 0; i < cpuOutput.length; i += 4) {
      const delta = Math.abs(cpuOutput.readFloatLE(i) - gpuOutput.readFloatLE(i));
      if (!Number.isFinite(delta)) throw Error(`Nonfinite result for ${name} at ${i}`);
      maxAbs = Math.max(maxAbs, delta);
    }
    console.log(JSON.stringify({ name, maxAbs }));
  }
}
