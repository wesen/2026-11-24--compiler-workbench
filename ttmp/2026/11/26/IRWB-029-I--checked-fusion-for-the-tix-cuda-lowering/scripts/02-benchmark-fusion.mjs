// IRWB-029-I script 02: fused vs stage-2 (unfused) corpus benchmarks at the brief's sizes.
//
// For each corpus program: run the fused and the unfused lowering once each under the runner's
// --timed lock (one warm-up launch, median of three CUDA-event timings), compare the two full-size
// outputs bit for bit, and account the global-memory bytes each plan's kernels touch from the
// recorded kernel plan (each distinct tensor element counted once per kernel — the perfect-L2-reuse
// lower bound) against the 244 GB/s streaming floor measured with a y = 2x kernel.
import { readFile } from 'node:fs/promises';
import { compileTix, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { lowerCuda } from '../../../../../../dist/tensor/cuda-source.js';

const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
const GB = 244e9; // measured streaming bandwidth of the GB10 (y = 2x kernel)
const words = ({ data }) => new Uint32Array(data.buffer, data.byteOffset, data.length);
const same = (a, b) =>
  a.shape.join() === b.shape.join() &&
  words(a).length === words(b).length &&
  words(a).every((w, i) => w === words(b)[i]);

const rows = [];
for (const [name, symbols] of Object.entries(sizes)) {
  const source = await readFile(new URL('../../../../../../corpus/tensor/' + name + '/main.tix', import.meta.url), 'utf8');
  const program = compileTix(source);
  const fn = program.current.value.functions[0];
  const tensors = new Map([...fn.params, ...fn.statements].map(t => [t.name, t]));
  const extent = a => a.constant + a.terms.reduce((n, [k, c]) => n + c * symbols[k], 0);
  const bytes = t => tensors.get(t).shape.reduce((n, a) => n * extent(a), 1) * 4;
  let state = name.length * 7919 + 3;
  const random = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const inputs = {};
  for (const p of fn.params) {
    const shape = p.shape.map(extent);
    inputs[p.name] = {
      shape,
      data: Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, () => 0.5 + random() / 2),
    };
  }
  const account = fuse => {
    const unit = lowerCuda(fn, fuse);
    return unit.kernels.map((k, i) => ({
      kernel: 'k' + i,
      form: k.form,
      statements: k.statements,
      readBytes: k.reads.reduce((n, t) => n + bytes(t), 0),
      writeBytes: k.writes.reduce((n, t) => n + bytes(t), 0),
    }));
  };
  const unfusedPlan = account(false);
  const fusedPlan = account(true);
  const unfused = await runTixCuda(program, name, inputs, { fuse: false, benchmark: true });
  const fused = await runTixCuda(program, name, inputs, { fuse: true, benchmark: true });
  const sum = plan => plan.reduce((n, k) => n + k.readBytes + k.writeBytes, 0);
  rows.push({
    name,
    kernelsUnfused: unfusedPlan.length,
    kernelsFused: fusedPlan.length,
    unfusedMs: unfused.gpuMs,
    fusedMs: fused.gpuMs,
    bytesUnfused: sum(unfusedPlan),
    bytesFused: sum(fusedPlan),
    identical: same(unfused, fused),
    unfusedPlan,
    fusedPlan,
  });
  console.log(
    name,
    'kernels', unfusedPlan.length, '->', fusedPlan.length,
    '| ms', unfused.gpuMs.toFixed(4), '->', fused.gpuMs.toFixed(4),
    '| MB', (sum(unfusedPlan) / 1e6).toFixed(1), '->', (sum(fusedPlan) / 1e6).toFixed(1),
    '| floor ms', (sum(fusedPlan) / GB * 1e3).toFixed(4),
    '| identical', rows.at(-1).identical,
  );
}
console.log('\n' + JSON.stringify(rows, null, 1));
