// Run from the worktree root after building. Benchmarks each corpus program at the brief's sizes, unfused and
// fused (median of three timed launches after a warm-up, under the GPU lock), and compares the output bits.
//   node <ticket>/scripts/08-benchmark-fusion.mjs [--threads 64,128,256] [--cpu] [names...]
// --threads also times the fused source with other threads per block (by editing the launch in the source).
// --cpu also compares with the f32 meaning evaluated in JS (slow for the contractions).
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { compileTix, cudaSource, runTix } = await import(new URL('dist/tensor/index.js', root));
const { runCudaBatch } = await import(new URL('dist/tensor/cuda-runtime.js', root));
const { rowThreads } = await import(new URL('dist/tensor/cuda-source.js', root));
const { value } = await import(new URL('dist/tensor/model.js', root));
const { seededRandom } = await import(new URL('dist/framework/contracts/index.js', root));

export const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
const argv = process.argv.slice(2);
const option = name => (argv.includes(name) ? argv.splice(argv.indexOf(name), 2)[1] : undefined);
const threads = (option('--threads') ?? '').split(',').filter(Boolean).map(Number);
const cpu = argv.includes('--cpu') && argv.splice(argv.indexOf('--cpu'), 1);
const sha = ({ data }) =>
  createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex').slice(0, 12);
for (const name of argv.length ? argv : Object.keys(sizes)) {
  const program = compileTix(await readFile(new URL(`corpus/tensor/${name}/main.tix`, root), 'utf8'));
  const fn = program.current.value.functions.find(f => f.name === name);
  const dims = new Map(Object.entries(sizes[name]));
  const random = seededRandom(20);
  const inputs = Object.fromEntries(
    fn.params.map(p => {
      const shape = p.shape.map(d => value(d, dims));
      const data = Float32Array.from({ length: shape.reduce((n, dim) => n * dim, 1) }, () =>
        name === 'layernorm' && p.name === 'eps' ? 1e-5 : 0.2 * random() - 0.1,
      );
      return [p.name, { shape, data }];
    }),
  );
  const run = async source => (await runCudaBatch(source, fn, [inputs], { benchmark: true }))[0];
  const kernels = source => source.match(/__global__ void/g).length;
  const unfused = cudaSource(program, name, { fuse: false }),
    fused = cudaSource(program, name);
  const base = await run(unfused);
  const line = { name, unfused: { kernels: kernels(unfused), ms: +base.gpuMs.toFixed(4), sha: sha(base) } };
  if (cpu) line.meaning = sha(runTix(program, name, inputs));
  if (fused === unfused) line.fused = 'same source';
  else {
    const result = await run(fused);
    line.fused = { kernels: kernels(fused), ms: +result.gpuMs.toFixed(4), sha: sha(result) };
    for (const t of threads) {
      const edited = fused.replaceAll(`, ${rowThreads}, spill_`, `, ${t}, spill_`);
      if (t !== rowThreads && edited !== fused) line['threads' + t] = +(await run(edited)).gpuMs.toFixed(4);
    }
  }
  console.log(JSON.stringify(line));
}
