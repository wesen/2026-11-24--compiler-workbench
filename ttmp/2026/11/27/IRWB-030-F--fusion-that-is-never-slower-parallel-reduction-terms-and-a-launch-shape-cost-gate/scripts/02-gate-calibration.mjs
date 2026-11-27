// IRWB-030-F script 02: calibrate the cost gate. Fused (ungated source, staging on) against unfused
// (fuse: false), sweeping the number of block points (rows) at fixed per-row work:
//   - streaming-bound row members (softmax and layernorm-inside at a fixed 16 MiB, C = 16M/N),
//   - contraction row members (attention at K = 1024, D = V = 64; mlp at D = 256, H = 1024, O = 256).
// Each point: one benchmark call (warm-up + median of three CUDA-event intervals) per lowering, under the
// runner's --timed lock, plus output digests and the gate's inputs (points, threads, longest row).
//   node ttmp/2026/11/27/IRWB-030-F--*/scripts/02-gate-calibration.mjs [--only=name ...]
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { groupCap } from '../../../../../../dist/tensor/fusion.js';
import { value } from '../../../../../../dist/tensor/model.js';

const insideLayernorm = `fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
  mean[i] = sum(d) x[i,d] / D;
  centered[i,j] = x[i,j] - mean[i];
  variance[i] = sum(d) centered[i,d] * centered[i,d] / D;
  y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
  return y;
}`;

const bytes = 4194304; // 16 MiB of f32
const families = [
  {
    name: 'softmax',
    source: readFileSync('corpus/tensor/softmax/main.tix', 'utf8'),
    fn: 'softmax',
    // Fixed bytes: C = 16 MiB / N
    points: [4, 16, 64, 128, 256, 512, 1024, 4096].map(N => ({ N, C: bytes / N })),
  },
  {
    name: 'layernorm-inside',
    source: insideLayernorm,
    fn: 'layernorm',
    points: [4, 16, 64, 128, 256, 512, 1024, 4096].map(N => ({ N, D: bytes / 4 / N, N0: N })),
  },
  {
    name: 'attention',
    source: readFileSync('corpus/tensor/attention/main.tix', 'utf8'),
    fn: 'attention',
    points: [8, 16, 32, 64, 128, 256, 512, 1024].map(Q => ({ Q, K: 1024, D: 64, V: 64 })),
  },
  {
    name: 'mlp',
    source: readFileSync('corpus/tensor/mlp/main.tix', 'utf8'),
    fn: 'mlp',
    points: [64, 128, 256, 512, 1024].map(N => ({ N, D: 256, H: 1024, O: 256 })),
  },
];
// layernorm-inside keeps D = 16 MiB / 4 / N so the tensor stays 16 MiB
for (const point of families[1].points) {
  point.D = bytes / 4 / point.N;
  delete point.N0;
}

const tensors = new Map();
for (const family of families) {
  const program = compileTix(family.source);
  const fn = program.current.value.functions.find(f => f.name === family.fn);
  tensors.set(family.name, { program, fn });
}

function makeInputs(fn, dims) {
  const random = seededRandom(20);
  const map = new Map(Object.entries(dims));
  return Object.fromEntries(
    fn.params.map(p => {
      const shape = p.shape.map(d => value(d, map));
      const data = Float32Array.from({ length: shape.reduce((n, d) => n * d, 1) }, () =>
        p.name === 'eps' ? 1e-5 : 0.2 * random() - 0.1,
      );
      return [p.name, { shape, data }];
    }),
  );
}

const digest = result =>
  createHash('sha256').update(Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength)).digest('hex');

// The gate's own inputs at a point: block points, threads per block, longest row.
function gateInputs(name, dims) {
  const { fn } = tensors.get(name);
  const plan = planFusion(fn);
  const group = plan.groups.find(g => g.mapping === 'block');
  if (!group) return null;
  const map = new Map(Object.entries(dims));
  let points = 1;
  for (let p = 0; p < group.depth; p++) points *= value(group.statements.map(s => fn.statements.find(t => t.name === s)).at(0).shape[p], map);
  let longest = 1;
  for (const n of [...group.staged, ...group.statements]) {
    const shape = [...fn.params, ...fn.statements].find(t => t.name === n).shape;
    let product = 1;
    for (const a of shape.slice(group.depth)) product *= value(a, map);
    longest = Math.max(longest, product);
  }
  const all = new Map([...fn.params, ...fn.statements].map(t => [t.name, t]));
  const threads = Math.min(groupCap(group, all), Math.max(32, Math.ceil(longest / 32) * 32));
  return { points, threads, longest, fusedThreads: points * threads };
}

const only = process.argv.filter(a => a.startsWith('--only=')).map(a => a.slice(7));
const at = process.argv.filter(a => a.startsWith('--at=')).map(a => Number(a.slice(5)));
for (const family of families) {
  if (only.length && !only.includes(family.name)) continue;
  for (const dims of at.length ? family.points.filter(p => Object.values(p).some(v => at.includes(v))) : family.points) {
    const { program, fn } = tensors.get(family.name);
    const inputs = makeInputs(fn, dims);
    const row = { name: family.name, ...dims, ...gateInputs(family.name, dims) };
    const source = cudaSource(program, family.fn);
    const [fused] = await runCudaBatch(source, fn, [inputs], { benchmark: true });
    row.fused = fused.gpuMs;
    row.fusedDigest = digest(fused);
    const unfused = await runTixCuda(program, family.fn, inputs, { fuse: false, benchmark: true });
    row.unfused = unfused.gpuMs;
    row.unfusedDigest = digest(unfused);
    row.equal = row.fusedDigest === row.unfusedDigest;
    row.ratio = row.fused / row.unfused;
    console.log(JSON.stringify(row));
  }
}
