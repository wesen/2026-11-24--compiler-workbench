// Replay the serial schedule, and optionally launch the score contraction over its full grid.
import { workload } from './01-benchmark.mjs';
import { emitCuda } from '../../../../../../dist/tensor/cuda-source.js';
import { planFusion, unfusedPlan } from '../../../../../../dist/tensor/fusion.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { visit } from '../../../../../../dist/tensor/model.js';

for (const label of ['attention-inside', 'layernorm-inside', 'layernorm']) {
  const { name, program, inputs } = workload(label);
  const fn = program.current.value.functions[0];
  const proxy = structuredClone(fn);
  // Only the planner sees this proxy. Defeat the divided-contraction cut without changing dependencies.
  for (const m of proxy.statements) visit(m.expr, e => { if (e.op === '/') e.op = '*'; });
  const serial = planFusion(proxy);
  for (const g of serial.groups) g.parallelTerms = {};
  const choices = { serial };
  if (name === 'attention') {
    const [score, ...rest] = proxy.statements;
    const tail = planFusion({ ...proxy, params: [...proxy.params, score], statements: rest });
    choices.scoreSeparate = { ...tail, groups: [unfusedPlan(fn).groups[0],
      ...tail.groups.map((g,i) => ({ ...g, kernel: 'k' + (i+1) }))] };
  }
  for (const [mode, plan] of Object.entries(choices)) {
    const source = emitCuda(fn, plan);
    for (let i=0;i<3;i++) {
      const [result] = await runCudaBatch(source, fn, [inputs], { benchmark: true });
      console.log(JSON.stringify({ label, mode, gpuMs: result.gpuMs }));
    }
  }
}
