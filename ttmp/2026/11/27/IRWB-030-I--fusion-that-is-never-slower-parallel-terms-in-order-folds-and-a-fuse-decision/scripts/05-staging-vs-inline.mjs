// IRWB-030-I script 05: the staged fold against the same fused kernel with inline folds (stage 3's lowering),
// and both against stage 2. The inline-fold column is planFusion's groups with the terms cleared, which is
// byte-for-byte stage 3's kernel bodies apart from the comment line. Three benchmark calls per column.
//   node <ticket>/scripts/05-staging-vs-inline.mjs [name ...]
import { createHash } from 'node:crypto';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { runTixCuda } from '../../../../../../dist/tensor/index.js';
import { corpusInputs } from './01-baseline.mjs';

const digest = ({ data }) =>
  createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex');

if (import.meta.url === `file://${process.argv[1]}`) {
  const names = process.argv.slice(2);
  for (const name of names.length ? names : ['layernorm', 'layernorm-inside', 'softmax', 'attention-inside', 'mlp']) {
    const { program, fn, inputs } = corpusInputs(name);
    const columns = {};
    for (const variant of ['staged', 'inlineFolds', 'unfused']) {
      const times = [];
      let last;
      for (let i = 0; i < 3; ++i) {
        if (variant === 'unfused') last = await runTixCuda(program, fn.name, inputs, { benchmark: true, fuse: false });
        else {
          const { runCudaBatch } = await import('../../../../../../dist/tensor/cuda-runtime.js');
          const { emitCuda } = await import('../../../../../../dist/tensor/cuda-source.js');
          const plan = planFusion(fn);
          if (variant === 'inlineFolds') for (const g of plan.groups) g.terms = [];
          [last] = await runCudaBatch(emitCuda(fn, plan), fn, [inputs], { benchmark: true });
        }
        times.push(last.gpuMs);
      }
      columns[variant] = {
        median: [...times].sort((a, b) => a - b)[1],
        times,
        digest: digest(last),
      };
    }
    console.log(
      JSON.stringify({
        name,
        ...columns,
        allEqual: new Set(Object.values(columns).map(c => c.digest)).size === 1,
      }),
    );
  }
}
