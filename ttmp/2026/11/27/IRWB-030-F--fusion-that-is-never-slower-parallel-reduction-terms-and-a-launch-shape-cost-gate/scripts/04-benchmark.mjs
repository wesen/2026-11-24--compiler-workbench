// IRWB-030-F script 04: the report's benchmark table. For each corpus program and the two "inside" variants
// (corpus/tensor/{layernorm,attention}-inside), at the brief's sizes, fused (the default, gated at the launch
// shapes) and unfused (fuse: false):
//   - the kernel count of cudaSource (number of __global__ definitions);
//   - the benchmark GPU time: three benchmark calls (each one warm-up launch and the median of three
//     CUDA-event intervals, under the runner's --timed lock), reporting the median and the spread;
//   - the output digests, to compare fused and unfused bit for bit;
//   - per block-mode kernel, the reductions the plan stages in parallel (and those it refuses, with why).
//   node ttmp/2026/11/27/IRWB-030-F--*/scripts/04-benchmark.mjs [name ...]
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { value } from '../../../../../../dist/tensor/model.js';

export const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  'layernorm-inside': { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  'attention-inside': { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};

const digest = result =>
  createHash('sha256').update(Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength)).digest('hex');
const round = x => Math.round(x * 1e4) / 1e4;
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1];

const names = process.argv.slice(2).filter(a => !a.startsWith('--'));
for (const name of names.length ? names : Object.keys(sizes)) {
  const program = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
  const fn = program.current.value.functions[0];
  const map = new Map(Object.entries(sizes[name]));
  const random = seededRandom(20);
  const inputs = Object.fromEntries(
    fn.params.map(p => {
      const shape = p.shape.map(d => value(d, map));
      const data = Float32Array.from({ length: shape.reduce((n, d) => n * d, 1) }, () =>
        p.name === 'eps' ? 1e-5 : 0.2 * random() - 0.1,
      );
      return [p.name, { shape, data }];
    }),
  );
  const row = { name, sizes: sizes[name] };
  for (const fuse of [true, false]) {
    const label = fuse ? 'fused' : 'unfused';
    const times = [];
    let result;
    for (let i = 0; i < 3; i++) {
      result = await runTixCuda(program, fn.name, inputs, { fuse, benchmark: true });
      times.push(result.gpuMs);
    }
    row[label] = {
      kernels: (cudaSource(program, fn.name, { fuse }).match(/__global__ void/g) ?? []).length,
      gpuMs: [round(median(times)), ...times.map(round)],
      outputSha256: digest(result),
    };
  }
  row.equal = row.fused.outputSha256 === row.unfused.outputSha256;
  row.speedUp = Math.round((row.unfused.gpuMs[0] / row.fused.gpuMs[0]) * 100) / 100;
  const plan = planFusion(fn);
  row.parallelTerms = plan.groups.map(g =>
    g.mapping === 'block'
      ? {
          kernel: g.kernel,
          statements: g.statements,
          staged: g.parallelTerms.map(t => t.description),
        }
      : null,
  );
  console.log(JSON.stringify(row));
}
