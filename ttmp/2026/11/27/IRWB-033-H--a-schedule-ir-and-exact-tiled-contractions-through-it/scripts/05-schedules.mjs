// IRWB-033-H script 05: what schedule each corpus program gets, and the kernel count of both lowerings.
//   node 05-schedules.mjs
import { readFileSync } from 'node:fs';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { lowerToCuda } from '../../../../../../dist/tensor/cuda-source.js';

const kernels = source => (source.match(/__global__ void/g) ?? []).length;
for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const program = compileTix(readFileSync(new URL(`../../../../../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
  const fn = program.current.value.functions[0];
  const { source, schedule } = lowerToCuda(fn, true);
  console.log(`\n== ${name}: ${kernels(cudaSource(program, name))} kernel(s) fused, ` +
    `${kernels(cudaSource(program, name, { fuse: false }))} unfused`);
  for (const k of schedule.kernels) {
    const c = k.contraction;
    console.log(
      `  ${k.kernel}: ${k.mapping} [${k.statements.join(', ')}] depth ${k.depth} stored ${JSON.stringify(k.stored)}` +
        (k.gated ? ' gated' : '') +
        ` threads ${JSON.stringify(k.threads)}`,
    );
    if (c)
      console.log(
        `      contraction on ${c.axis}, order ${c.order.outer}/${c.order.inner}, peel ${c.peelTail}, ` +
          `unroll ${JSON.stringify(c.unroll)}, fallback ${c.fallback}\n      variants ` +
          c.variants
            .map(v => `${v.blockRows}x${v.blockCols} tile ${v.tile} patch ${v.patchRows}x${v.patchCols} (${(v.blockRows / v.patchRows) * (v.blockCols / v.patchCols)} threads)`)
            .join('\n               '),
      );
  }
}
