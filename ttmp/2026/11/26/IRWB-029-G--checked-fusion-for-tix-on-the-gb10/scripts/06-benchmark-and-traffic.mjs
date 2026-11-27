// The stage's measurement: kernel count, benchmark GPU time, global-memory traffic by count, and the time those
// bytes would take at 244 GB/s, for every corpus program at the brief's sizes, fused and unfused.
//
// Timing uses `benchmark: true`, which takes the tool's --timed GPU lock, runs one warm-up launch and reports the
// median of three CUDA-event intervals around the kernels only (no transfers, no start-up). Each program and
// lowering is one short remote invocation, so the twelve values below are each a single observation of that median.
//
// Traffic is counted from the lowering, not measured: every global load site (a load that is not served from shared
// memory) times the number of times it executes, plus one store for every element written to global memory by a
// kernel whose output is global.
//
//   node <ticket>/scripts/06-benchmark-and-traffic.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { compileTix, cudaSource, runTixCuda } = await import(new URL('dist/tensor/index.js', root));
const { planFusion } = await import(new URL('dist/tensor/fusion.js', root));
const { value } = await import(new URL('dist/tensor/model.js', root));
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
const bandwidth = 244e9;

// ---------------------------------------------------------------- traffic

function extentOf(extent, dims) {
  if (extent.kind !== 'dim') throw Error('this program has generated bounds; run it through optimizeTix first');
  return value(extent.dim, dims);
}
const product = (axes, dims) => axes.reduce((n, axis) => n * extentOf(axis.extent, dims), 1);

function treeTraffic(expr, scale, dims, staged, out, touched) {
  if (expr.kind === 'load') {
    if (!staged.has(expr.name)) {
      out.reads += scale * 4;
      touched.add(expr.name);
    }
    return;
  }
  if (expr.kind === 'op') for (const arg of expr.args) treeTraffic(arg, scale, dims, staged, out, touched);
  if (expr.kind === 'reduce')
    treeTraffic(expr.body, scale * product(expr.axes, dims), dims, staged, out, touched);
}

function kernelTraffic(kernel, dims, elementCount) {
  const out = { reads: 0, writes: 0, compulsory: 0 };
  const touched = new Set(),
    written = new Set();
  if (kernel.kind === 'flat') {
    const elements = product(kernel.anchor.axes, dims);
    const staged = new Set(kernel.inline.map(s => s.name));
    treeTraffic(kernel.anchor.expr, elements, dims, staged, out, touched);
    for (const producer of kernel.inline) treeTraffic(producer.expr, elements, dims, staged, out, touched);
    out.writes += elements * 4;
    written.add(kernel.anchor.name);
  } else {
    const blocks = product(kernel.rows, dims);
    for (const phase of kernel.phases) {
      if (phase.kind === 'stage') {
        // the whole row is copied from global memory exactly once per block
        out.reads += blocks * value(kernel.slots[phase.slot].dim, dims) * 4;
        touched.add(phase.tensor);
        continue;
      }
      const statement = phase.statement;
      const extra =
        statement.axes.length > kernel.rows.length
          ? extentOf(statement.axes[kernel.rows.length].extent, dims)
          : 1;
      treeTraffic(statement.expr, blocks * extra, dims, kernel.staged, out, touched);
      if (phase.dest.kind === 'global') {
        out.writes += blocks * extra * 4;
        written.add(statement.name);
      }
    }
  }
  // each distinct tensor a kernel touches, once: a lower bound on what must come from or go to DRAM
  for (const name of touched) out.compulsory += elementCount(name) * 4;
  for (const name of written) out.compulsory += elementCount(name) * 4;
  return out;
}
// ------------------------------------------------------------------ main

const random = seededRandom(20);
const rows = [];
for (const [name, shape] of Object.entries(sizes)) {
  const program = compileTix(await readFile('corpus/tensor/' + name + '/main.tix', 'utf8'));
  const fn = program.current.value.functions[0];
  const inputs = {};
  for (const [parameter, axes] of params[name]) {
    const dims = axes.map(axis => (axis === 'one' ? 1 : axis === 'three' ? 3 : shape[axis]));
    const count = dims.reduce((a, b) => a * b, 1);
    const data = Float32Array.from({ length: count }, () => 2 * random() - 1);
    if (parameter === 'eps') data[0] = 1e-5;
    inputs[parameter] = { shape: dims, data };
  }
  const elementCount = name => {
    const tensor = [...fn.params, ...fn.statements].find(t => t.name === name);
    return tensor.shape.reduce((n, axis) => n * value(axis, dims), 1);
  };
  const dims = new Map(Object.entries(shape));
  dims.set('one', 1);
  dims.set('three', 3);
  const plans = {
    unfused: fn.statements.map(anchor => ({ kind: 'flat', anchor, inline: [] })),
    fused: planFusion(fn),
  };
  for (const [label, plan] of Object.entries(plans)) {
    const perKernel = plan.map(kernel => kernelTraffic(kernel, dims, elementCount));
    const reads = perKernel.reduce((n, k) => n + k.reads, 0);
    const writes = perKernel.reduce((n, k) => n + k.writes, 0);
    const compulsory = perKernel.reduce((n, k) => n + k.compulsory, 0);
    const result = await runTixCuda(program, name, inputs, { fuse: label === 'fused', benchmark: true });
    rows.push({
      name,
      label,
      kernels: (cudaSource(program, name, { fuse: label === 'fused' }).match(/__global__ void/g) ?? []).length,
      gpuMs: result.gpuMs,
      reads,
      writes,
      compulsory,
      floorMs: ((reads + writes) / bandwidth) * 1e3,
      compulsoryMs: (compulsory / bandwidth) * 1e3,
      perKernel,
    });
  }
  const [plain, fused] = rows.slice(-2);
  console.log(
    `${name.padEnd(9)} kernels ${plain.kernels} -> ${fused.kernels}  ` +
      `gpuMs ${plain.gpuMs.toFixed(4)} -> ${fused.gpuMs.toFixed(4)}  ` +
      `(${(plain.gpuMs / fused.gpuMs).toFixed(2)}x)  ` +
      `issued MB ${((plain.reads + plain.writes) / 1e6).toFixed(1)} -> ${((fused.reads + fused.writes) / 1e6).toFixed(1)}  ` +
      `floor ms ${plain.floorMs.toFixed(3)} -> ${fused.floorMs.toFixed(3)}  ` +
      `compulsory MB ${(plain.compulsory / 1e6).toFixed(1)} -> ${(fused.compulsory / 1e6).toFixed(1)}  ` +
      `compulsory ms ${plain.compulsoryMs.toFixed(3)} -> ${fused.compulsoryMs.toFixed(3)}`,
  );
  console.log(
    '  unfused per kernel (read MB, write MB):',
    plain.perKernel.map(k => `(${(k.reads / 1e6).toFixed(1)}, ${(k.writes / 1e6).toFixed(1)})`).join(' '),
  );
  console.log(
    '  fused per kernel (read MB, write MB):  ',
    fused.perKernel.map(k => `(${(k.reads / 1e6).toFixed(1)}, ${(k.writes / 1e6).toFixed(1)})`).join(' '),
  );
}
console.log(JSON.stringify(rows));
