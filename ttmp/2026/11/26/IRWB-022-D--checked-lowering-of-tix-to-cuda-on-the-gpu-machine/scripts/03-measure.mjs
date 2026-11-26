// From repository root after build: node <this file> <cpu|gpu|compare> /tmp/my-results.
// cpu and gpu run independently and save results outside the repository. compare reads both.
import { compileTix, runTix } from '../../../../../../dist/tensor/index.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { value } from '../../../../../../dist/tensor/model.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const [, , mode, dir] = process.argv;
const configs = {
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
};
mkdirSync(dir, { recursive: true });
for (const [name, config] of Object.entries(configs)) {
  const prog = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
  const fn = prog.current.value.functions[0];
  const make = small => {
    const rand = seededRandom(22),
      dims = new Map(Object.entries(config).map(([k, v]) => [k, small ? 4 : v]));
    return Object.fromEntries(
      fn.params.map(p => {
        const shape = p.shape.map(a => value(a, dims));
        const data = Float32Array.from({ length: shape.reduce((a, b) => a * b) }, () =>
          p.name === 'eps' ? 1e-5 : rand() * 0.2 - 0.1,
        );
        return [p.name, { shape, data }];
      }),
    );
  };
  const file = `${dir}/${name}.bin`;
  if (mode === 'cpu') {
    const inputs = make(false);
    runTix(prog, name, make(true));
    const start = performance.now();
    const out = runTix(prog, name, inputs);
    const cpuMs = performance.now() - start;
    writeFileSync(file, Buffer.from(out.data.buffer));
    console.log(JSON.stringify({ name, shape: out.shape, cpuMs }));
  } else if (mode === 'gpu') {
    const { runBatch } = await import('../../../../../../dist/tensor/cuda-run.js');
    const { cudaSource } = await import('../../../../../../dist/tensor/index.js');
    const inputs = make(false),
      outs = await runBatch(fn, cudaSource(prog, name), [inputs, inputs, inputs], { timed: true });
    writeFileSync(file + '.gpu', Buffer.from(outs[2].data.buffer));
    console.log(JSON.stringify({ name, shape: outs[2].shape, gpuMs: outs.map(o => o.gpuMs) }));
  } else if (mode === 'compare') {
    const gpu = readFileSync(file + '.gpu'),
      data = new Float32Array(gpu.buffer, gpu.byteOffset, gpu.length / 4),
      ref = readFileSync(file);
    if (ref.length !== data.byteLength) throw Error('shape');
    let max = 0,
      index = 0;
    for (let i = 0; i < data.length; i++) {
      const diff = Math.abs(data[i] - ref.readFloatLE(i * 4));
      if (!Number.isFinite(diff)) throw Error('nonfinite');
      if (diff > max) {
        max = diff;
        index = i;
      }
    }
    console.log(JSON.stringify({ name, max, index }));
  } else throw Error('cpu | gpu | compare');
}
