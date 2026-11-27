// IRWB-030-J script 04: what the staging decisions cost, at the corpus sizes, through benchmark mode.
//   - softmax with the refused bare-load reductions (m, s) staged by force, against the rule that refuses them:
//     shows the terms buffer and the extra barriers cost without removing serial work.
//   - inside layernorm with its staged divisions unstaged (stage 3's serial fold), against the rule: the win.
//   - inside layernorm's block-mode thread cap re-measured at 64, 128, 256 (stage 3 chose 128 for rows only).
// The patches go through the plan (emitCuda), so what is measured is exactly what the emitter would print.
//   node <ticket>/scripts/04-staging-cost.mjs
import { readFileSync } from 'node:fs';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { emitCuda } from '../../../../../../dist/tensor/cuda-source.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { value } from '../../../../../../dist/tensor/model.js';

// the member's reductions in pre-order, the order the planner numbers them by
const reducesOf = statement => {
  const out = [];
  const walk = e => {
    if (e.kind === 'reduce') out.push(e);
    if (e.kind === 'op') e.args.forEach(walk);
    else if (e.kind === 'reduce') walk(e.body);
  };
  walk(statement.expr);
  return out;
};
const stageEverything = (plan, fn) => ({
  ...plan,
  groups: plan.groups.map(g => ({
    ...g,
    terms: g.statements.flatMap(name => {
      const statement = fn.statements.find(s => s.name === name);
      return reducesOf(statement)
        .map((r, index) => ({ r, index }))
        .filter(({ r }) => statement.axes.length === g.depth && r.axes.every(a => a.extent.kind === 'dim'))
        .map(({ r, index }) => ({
          member: name,
          index,
          op: r.op,
          axes: r.axes.map(a => a.id),
          reason: 'forced',
        }));
    }),
  })),
});
const inputsOf = (fn, dims, seed = 20) => {
  const shapes = new Map(Object.entries(dims));
  const random = seededRandom(seed);
  return Object.fromEntries(
    fn.params.map(p => [
      p.name,
      {
        shape: p.shape.map(a => value(a, shapes)),
        data: Float32Array.from(
          { length: p.shape.reduce((n, a) => n * value(a, shapes), 1) },
          () => 0.2 * random() - 0.1,
        ),
      },
    ]),
  );
};
const time = async (source, fn, inputs) => {
  const [result] = await runCudaBatch(source, fn, [inputs], { benchmark: true });
  return result;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const softmaxProgram = compileTix(readFileSync('corpus/tensor/softmax/main.tix', 'utf8'));
  const softmax = softmaxProgram.current.value.functions[0];
  const softmaxInputs = inputsOf(softmax, { N: 4096, C: 1024 });
  const softmaxPlan = planFusion(softmax);
  const forced = stageEverything(softmaxPlan, softmax);
  console.log(
    JSON.stringify({
      program: 'softmax',
      variant: 'rule (m and s refused)',
      staged: softmaxPlan.groups[0].terms.length,
      gpuMs: (await time(emitCuda(softmax, softmaxPlan), softmax, softmaxInputs)).gpuMs,
    }),
  );
  console.log(
    JSON.stringify({
      program: 'softmax',
      variant: 'm and s staged by force',
      staged: forced.groups[0].terms.length,
      gpuMs: (await time(emitCuda(softmax, forced), softmax, softmaxInputs)).gpuMs,
    }),
  );

  const inside = compileTix(`fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
    mean[i] = sum(d) x[i,d] / D;
    centered[i,j] = x[i,j] - mean[i];
    variance[i] = sum(j) centered[i,j] * centered[i,j] / D;
    y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
    return y;
  }`);
  const layernorm = inside.current.value.functions[0];
  const inputs = inputsOf(layernorm, { N: 4096, D: 1024 });
  inputs.eps = { shape: [1], data: Float32Array.of(1e-5) };
  const plan = planFusion(layernorm);
  const unstaged = { ...plan, groups: plan.groups.map(g => ({ ...g, terms: [], termRefusals: [] })) };
  console.log(
    JSON.stringify({
      program: 'layernorm-inside',
      variant: 'staged (the rule)',
      gpuMs: (await time(emitCuda(layernorm, plan), layernorm, inputs)).gpuMs,
    }),
  );
  console.log(
    JSON.stringify({
      program: 'layernorm-inside',
      variant: 'unstaged (stage 3 fold)',
      gpuMs: (await time(emitCuda(layernorm, unstaged), layernorm, inputs)).gpuMs,
    }),
  );
  for (const cap of [64, 128, 256]) {
    const capped = {
      ...plan,
      groups: plan.groups.map(g => ({ ...g, threadCap: cap })),
    };
    console.log(
      JSON.stringify({
        program: 'layernorm-inside',
        variant: `staged, cap ${cap}`,
        gpuMs: (await time(emitCuda(layernorm, capped), layernorm, inputs)).gpuMs,
      }),
    );
  }
}
