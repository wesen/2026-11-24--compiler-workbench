// IRWB-029-F script 03: corpus measurements at the brief's sizes, fused and unfused.
//
// For each corpus program it reports, per lowering: the kernel count, the benchmark GPU time (warm-up plus
// the median of three CUDA-event intervals, under the tool's --timed lock), the global-memory bytes each
// kernel reads and writes by the analytic count below, and the time those bytes would take at 244 GB/s.
// The fused and unfused outputs are compared bit for bit (NaN as a class).
//
// Byte model (an analytic count over the fusion plan and the IR, not a measurement):
//  - one execution of a statement's expression tree per output element; a load site inside reductions runs
//    elements x product(enclosing reduction extents) times, 4 bytes each;
//  - a stage 2 single kernel reads every load site from global memory and writes the whole statement;
//  - a fused row group stages row-local tensors: out-of-group rows are read once per row (cooperative copy),
//    in-group values pass through shared memory, and only statements consumed outside the group (including
//    the result) are written to global memory;
//  - a fused chain forwards producer values through registers: in-group reads and intermediate writes vanish.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../../../');
const { compileTix, cudaSource } = await import(join(root, 'dist/tensor/index.js'));
const { runCudaBatch } = await import(join(root, 'dist/tensor/cuda-runtime.js'));
const { fusionPlan, singleSegments, classifyLoad } = await import(join(root, 'dist/tensor/fusion.js'));
const { value, visit } = await import(join(root, 'dist/tensor/model.js'));

const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};

const countBytes = (fn, dims, fuse) => {
  const tensors = new Map([...fn.params, ...fn.statements].map(t => [t.name, t]));
  const size = t => t.shape.reduce((n, d) => n * value(d, dims), 1);
  const slice = t => t.shape.slice(1).reduce((n, d) => n * value(d, dims), 1);
  const plan = fuse ? fusionPlan(fn) : { segments: singleSegments(fn) };
  return plan.segments.map(seg => {
    const statements =
      seg.kind === 'single' ? [fn.statements[seg.index]] : fn.statements.slice(seg.start, seg.end + 1);
    const groupNames = new Set(statements.map(s => s.name));
    const after = seg.kind === 'single' ? [] : fn.statements.slice(seg.end + 1);
    const external = new Set(
      statements
        .filter(
          s =>
            s.name === fn.result ||
            after.some(t => {
              let hit = false;
              visit(t.expr, e => {
                if (e.kind === 'load' && e.name === s.name) hit = true;
              });
              return hit;
            }),
        )
        .map(s => s.name),
    );
    const stagedOutside = new Set();
    const internal = new Set();
    if (seg.kind === 'row')
      for (const s of statements)
        visit(s.expr, e => {
          if (e.kind !== 'load') return;
          if (groupNames.has(e.name)) internal.add(e.name);
          else if (classifyLoad(e, s.axes[0].id, tensors, seg.row) === 'row-local') stagedOutside.add(e.name);
        });
    let reads = 0,
      writes = 0;
    if (seg.kind === 'row') {
      const rows = value(seg.row, dims);
      for (const name of stagedOutside) reads += rows * slice(tensors.get(name)) * 4;
    }
    for (const s of statements) {
      const elements = size(s);
      const loadBytes = (e, mult) => {
        if (e.kind === 'op') e.args.forEach(a => loadBytes(a, mult));
        else if (e.kind === 'reduce')
          loadBytes(e.body, mult * e.axes.reduce((n, a) => n * value(a.extent.dim, dims), 1));
        else if (e.kind === 'load') {
          const staged =
            seg.kind !== 'single' &&
            (internal.has(e.name) ||
              (stagedOutside.has(e.name) && classifyLoad(e, s.axes[0].id, tensors, seg.row) === 'row-local'));
          if (!staged) reads += elements * mult * 4;
        }
      };
      loadBytes(s.expr, 1);
      if (seg.kind === 'single') writes += elements * 4;
      else if (external.has(s.name)) writes += elements * 4;
    }
    return {
      segment: seg.kind,
      statements: statements.map(s => s.name),
      reads,
      writes,
      total: reads + writes,
    };
  });
};

for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(sizes)) {
  if (!sizes[name]) throw Error('Unknown corpus function ' + name);
  const program = compileTix(await readFile(join(root, 'corpus/tensor', name, 'main.tix'), 'utf8'));
  const fn = program.current.value.functions[0];
  const dims = new Map(Object.entries(sizes[name]));
  const random = (await import(join(root, 'dist/framework/contracts/index.js'))).seededRandom(20);
  const inputs = Object.fromEntries(
    fn.params.map(p => {
      const shape = p.shape.map(d => value(d, dims));
      const data = Float32Array.from({ length: shape.reduce((n, d) => n * d, 1) }, () =>
        name === 'layernorm' && p.name === 'eps' ? 1e-5 : 0.2 * random() - 0.1,
      );
      return [p.name, { shape, data }];
    }),
  );
  const row = { name, sizes: sizes[name] };
  for (const fuse of [true, false]) {
    const source = cudaSource(program, name, { fuse });
    const [result] = await runCudaBatch(source, fn, [inputs], { benchmark: true });
    row[fuse ? 'fused' : 'unfused'] = {
      kernels: (source.match(/__global__ void/g) ?? []).length,
      gpuMs: result.gpuMs,
      perKernel: countBytes(fn, dims, fuse),
      sha256: createHash('sha256')
        .update(Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength))
        .digest('hex'),
      data: result.data,
    };
  }
  const a = row.fused.data,
    b = row.unfused.data;
  row.bitIdentical =
    a.length === b.length && a.every((v, i) => v === b[i] || (Number.isNaN(v) && Number.isNaN(b[i])));
  delete row.fused.data;
  delete row.unfused.data;
  const bytesAt244 = bytes => (bytes / 244e9) * 1e3;
  for (const side of ['fused', 'unfused']) {
    row[side].perKernelMs244GBs = row[side].perKernel.map(k => bytesAt244(k.total));
    row[side].totalBytes = row[side].perKernel.reduce((n, k) => n + k.total, 0);
    row[side].totalMs244GBs = bytesAt244(row[side].totalBytes);
  }
  console.log(JSON.stringify(row));
}
