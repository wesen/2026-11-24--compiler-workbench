// IRWB-029-D script 10: global-memory bytes per kernel at the brief's sizes, by this count: each distinct tensor
// a kernel reads from global memory (a parameter or an earlier kernel's output) once at its full size, plus each
// tensor it stores. This is compulsory traffic with perfect caching: repeated reads of a tensor by many blocks
// (attention's k and v, mlp's w and v) are assumed to hit in the 24 MiB L2. Time at 244 GB/s, the measured
// streaming bandwidth (y = 2x) given in the brief.
//   node <ticket>/scripts/10-traffic.mjs [--markdown]
import { planFusion, unfusedPlan } from '../../../../../../dist/tensor/fusion.js';
import { value, visit } from '../../../../../../dist/tensor/model.js';
import { corpusInputs, sizes } from './04-benchmark.mjs';

const bandwidth = 244e9;
const rows = [];
for (const name of Object.keys(sizes)) {
  const { fn } = corpusInputs(name);
  const dims = new Map(Object.entries(sizes[name]));
  const tensors = new Map([...fn.params, ...fn.statements].map(t => [t.name, t]));
  const bytes = t => 4 * tensors.get(t).shape.reduce((n, d) => n * value(d, dims), 1);
  for (const [mode, plan] of [['fused', planFusion(fn)], ['unfused', unfusedPlan(fn)]]) {
    const kernels = plan.groups.map(g => {
      const inGroup = new Set(g.statements);
      const reads = new Set();
      for (const s of g.statements)
        visit(tensors.get(s).expr, e => {
          if (e.kind === 'load' && !inGroup.has(e.name)) reads.add(e.name);
        });
      const read = [...reads].reduce((n, t) => n + bytes(t), 0);
      const written = g.stored.reduce((n, t) => n + bytes(t), 0);
      return { kernel: g.kernel, statements: g.statements, reads: [...reads], stores: g.stored, read, written };
    });
    const total = kernels.reduce((n, k) => n + k.read + k.written, 0);
    rows.push({ name, mode, kernels, totalBytes: total, ms244: (total / bandwidth) * 1e3 });
  }
}
if (process.argv.includes('--markdown')) {
  const mb = n => (n / 2 ** 20).toFixed(2);
  console.log('| Program | Lowering | Kernel | Statements | Reads (MiB) | Writes (MiB) | ms at 244 GB/s |');
  console.log('| --- | --- | --- | --- | ---: | ---: | ---: |');
  for (const r of rows) {
    for (const k of r.kernels)
      console.log(
        `| ${r.name} | ${r.mode} | ${k.kernel} | ${k.statements.join(', ')} | ${mb(k.read)} (${k.reads.join(', ')}) | ${mb(k.written)} | ${(((k.read + k.written) / bandwidth) * 1e3).toFixed(4)} |`,
      );
    console.log(`| ${r.name} | ${r.mode} | total | | | | **${r.ms244.toFixed(4)}** (${mb(r.totalBytes)} MiB) |`);
  }
} else for (const r of rows) console.log(JSON.stringify(r));
