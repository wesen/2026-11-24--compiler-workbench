// Run from the worktree root after building. For each corpus program at the brief's sizes, unfused and fused:
// the bytes each kernel reads and writes in global memory, and the time they take at 244 GB/s.
// The count: a kernel reads every tensor it loads from global memory once, whole (4 bytes per element), and
// writes every tensor it stores once. Repeated loads of the same element (a contraction walks its operands many
// times) are not counted again: the number is the least traffic the kernel needs, which is what a streaming bound
// compares with. Values staged in shared memory are not global traffic.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { compileTix, kernelPlan } = await import(new URL('dist/tensor/index.js', root));
const { kernelTraffic } = await import(new URL('dist/tensor/cuda-source.js', root));
const { value } = await import(new URL('dist/tensor/model.js', root));
const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
const bandwidth = 244e9;
for (const [name, dims] of Object.entries(sizes)) {
  const program = compileTix(await readFile(new URL(`corpus/tensor/${name}/main.tix`, root), 'utf8'));
  const fn = program.current.value.functions.find(f => f.name === name);
  const env = new Map(Object.entries(dims));
  const bytes = new Map(
    [...fn.params, ...fn.statements].map(t => [t.name, 4 * t.shape.reduce((n, d) => n * value(d, env), 1)]),
  );
  const sum = names => names.reduce((n, t) => n + bytes.get(t), 0);
  for (const fuse of [false, true]) {
    const { plan } = kernelPlan(program, name, { fuse });
    const kernels = kernelTraffic(plan).map((k, i) => ({
      kernel: 'k' + i,
      statements: plan.kernels[i].mapping === 'row' ? plan.kernels[i].statements.join(' ') : plan.kernels[i].statement,
      mapping: plan.kernels[i].mapping,
      reads: k.reads.join(' '),
      readBytes: sum(k.reads),
      writes: k.writes.join(' '),
      writeBytes: sum(k.writes),
    }));
    const total = kernels.reduce((n, k) => n + k.readBytes + k.writeBytes, 0);
    console.log(
      JSON.stringify({ name, fuse, inlined: plan.inlined, totalBytes: total, msAt244GBs: +((total / bandwidth) * 1e3).toFixed(4) }),
    );
    for (const k of kernels)
      console.log('  ' + JSON.stringify({ ...k, ms: +(((k.readBytes + k.writeBytes) / bandwidth) * 1e3).toFixed(4) }));
  }
}
