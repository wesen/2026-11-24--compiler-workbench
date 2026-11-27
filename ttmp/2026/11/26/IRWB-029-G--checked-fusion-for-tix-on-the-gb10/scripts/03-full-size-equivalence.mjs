// Full-size equivalence: the fused lowering and stage 2's lowering must agree bit for bit on the six corpus
// programs at the brief's sizes. The Stage 1 interpreter cannot reach these sizes (matmul takes minutes), so the two
// GPU lowerings are compared with each other here, and both are compared with the f32 meaning at sample sizes in
// scripts/04 and in tests/tensor/cuda-gpu.test.mjs.
//
// Each program runs once per lowering in its own translation unit (no --timed), so this is not a timing report; the
// gpuMs values printed are single-launch observations, and scripts/05-benchmark.mjs does the benchmarked runs.
//
//   node <ticket>/scripts/03-full-size-equivalence.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { compileTix, cudaSource, runTixCuda } = await import(new URL('dist/tensor/index.js', root));
const { seededRandom } = await import(new URL('dist/framework/contracts/index.js', root));

const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
const params = {
  matmul: [['a', ['M', 'K']], ['b', ['K', 'N']]],
  softmax: [['x', ['N', 'C']]],
  layernorm: [['x', ['N', 'D']], ['gamma', ['D']], ['beta', ['D']], ['eps', ['one']]],
  attention: [['q', ['Q', 'D']], ['k', ['K', 'D']], ['v', ['K', 'V']]],
  mlp: [['x', ['N', 'D']], ['w', ['D', 'H']], ['bias', ['H']], ['v', ['H', 'O']], ['outBias', ['O']]],
  conv2d: [['x', ['N', 'C', 'H', 'W']], ['kernel', ['O', 'C', 'three', 'three']]],
};
const random = seededRandom(20);
const words = data => new Uint32Array(data.buffer, data.byteOffset, data.length);
const show = (a, b) => (a.length === b.length && a.every((w, i) => w === b[i]) ? 'identical' : 'DIFFERENT');

for (const [name, shape] of Object.entries(sizes)) {
  const source = await readFile('corpus/tensor/' + name + '/main.tix', 'utf8');
  const program = compileTix(source);
  const inputs = {};
  for (const [parameter, axes] of params[name]) {
    const dims = axes.map(axis => (axis === 'one' ? 1 : axis === 'three' ? 3 : shape[axis]));
    const count = dims.reduce((a, b) => a * b, 1);
    const data = Float32Array.from({ length: count }, () => 2 * random() - 1);
    if (parameter === 'eps') data[0] = 1e-5;
    inputs[parameter] = { shape: dims, data };
  }
  const plain = await runTixCuda(program, name, inputs, { fuse: false });
  const fused = await runTixCuda(program, name, inputs, { fuse: true });
  const count = text => (text.match(/__global__ void/g) ?? []).length;
  console.log(
    name.padEnd(9),
    'kernels',
    count(cudaSource(program, name, { fuse: false })),
    '->',
    count(cudaSource(program, name)),
    ' words',
    show(words(plain.data), words(fused.data)),
    ' shape',
    JSON.stringify(fused.shape),
    ' gpuMs',
    plain.gpuMs.toFixed(4),
    '->',
    fused.gpuMs.toFixed(4),
  );
}
