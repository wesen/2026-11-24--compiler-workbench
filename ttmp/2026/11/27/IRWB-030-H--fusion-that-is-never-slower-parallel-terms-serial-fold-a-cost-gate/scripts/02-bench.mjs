// IRWB-030-H script 02: measure the fused and unfused lowerings of a set of programs on the GB10.
//
// For each program and lowering it reports the kernel count (number of `__global__` definitions in cudaSource),
// the benchmark GPU time (one warm-up launch and the median of three CUDA-event intervals per call, under the
// runner's --timed lock) and the SHA-256 of the output, so the two lowerings can be compared bit for bit.
//
//   node <ticket>/scripts/02-bench.mjs [--runs=3] [--fuse=fused|unfused|both] [name ...]
//
// Names are corpus programs and the variants of script 01. One JSON object per (program, lowering) on stdout.
// Timed runs hold the GPU lock; keep --runs small and the name list short while other agents are working.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { value } from '../../../../../../dist/tensor/model.js';
import { sizes as corpusSizes, variants } from './01-programs.mjs';

const digest = ({ data }) =>
  createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex');
const kernels = source => (source.match(/__global__ void/g) ?? []).length;

export function load(name) {
  const variant = variants[name];
  const program = compileTix(
    variant
      ? variant.program
      : readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'),
  );
  const fn = program.current.value.functions[0];
  return { program, fn, sizes: variant ? variant.sizes : corpusSizes[name] };
}

export function inputs(name) {
  const { fn, sizes } = load(name);
  const dims = new Map(Object.entries(sizes));
  const random = seededRandom(20);
  return Object.fromEntries(
    fn.params.map(p => {
      const shape = p.shape.map(d => value(d, dims));
      const data = Float32Array.from({ length: shape.reduce((n, dim) => n * dim, 1) }, () =>
        name.startsWith('layernorm') && p.name === 'eps' ? 1e-5 : 0.2 * random() - 0.1,
      );
      return [p.name, { shape, data }];
    }),
  );
}

const args = process.argv.slice(2);
const runs = Number(args.find(a => a.startsWith('--runs='))?.slice(7) ?? 1);
const fuseArg = args.find(a => a.startsWith('--fuse='))?.slice(7) ?? 'both';
const names = args.filter(a => !a.startsWith('--'));
for (const name of names.length ? names : [...Object.keys(corpusSizes), ...Object.keys(variants)]) {
  const { program, fn } = load(name);
  const data = inputs(name);
  const row = { name };
  for (const fuse of fuseArg === 'both' ? [true, false] : [fuseArg === 'fused']) {
    const label = fuse ? 'fused' : 'unfused';
    const source = cudaSource(program, fn.name, { fuse });
    const times = [];
    let result;
    for (let i = 0; i < runs; i++) {
      result = await runTixCuda(program, fn.name, data, { fuse, benchmark: true });
      times.push(result.gpuMs);
    }
    times.sort((a, b) => a - b);
    row[label] = {
      kernels: kernels(source),
      gpuMs: times[times.length >> 1],
      times,
      outputSha256: digest(result),
    };
  }
  if (row.fused && row.unfused) {
    row.equal = row.fused.outputSha256 === row.unfused.outputSha256;
    row.ratio = +(row.unfused.gpuMs / row.fused.gpuMs).toFixed(3);
  }
  console.log(JSON.stringify(row));
}
