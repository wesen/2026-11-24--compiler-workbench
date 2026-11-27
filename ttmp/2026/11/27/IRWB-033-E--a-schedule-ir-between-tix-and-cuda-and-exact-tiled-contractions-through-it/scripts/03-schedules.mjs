// IRWB-033-E script 03: build every corpus program's schedule with the steps checked by the interpreter; print
// the kernels, the steps, the time of the checked build, and the kernel count of the printed source.
import { readFileSync } from 'node:fs';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { lowerToSchedule } from '../../../../../../dist/tensor/cuda-contract.js';
const root = new URL('../../../../../../', import.meta.url);
for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const p = compileTix(readFileSync(new URL(`corpus/tensor/${name}/main.tix`, root), 'utf8'));
  const f = p.current.value.functions[0];
  const t0 = performance.now();
  const { schedule, steps } = lowerToSchedule(f, true, true);
  const ms = Math.round(performance.now() - t0);
  console.log(
    JSON.stringify({
      name,
      checkedBuildMs: ms,
      kernels: schedule.value.kernels.map(k => ({
        name: k.name,
        kind: k.kind,
        statements: k.statements,
        ...(k.kind === 'tile' && { roles: k.roles, configs: k.configs }),
      })),
      steps: steps.map(s => [s.pass.replace('tensor.sched.', ''), s.changed, s.check ?? null]),
      definitions: (cudaSource(p, name).match(/__global__ void/g) ?? []).length,
    }),
  );
}
