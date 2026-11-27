// IRWB-030-J script 01: print the fusion plan and the emitted source of the inside placements, to review the
// staged terms and the decline rule by eye before running anything on the GPU.
//   node <ticket>/scripts/01-inspect.mjs [layernorm-inside|attention-inside|decline]
import { readFileSync } from 'node:fs';
import { compileTix, cudaSource, optimizeTix } from '../../../../../../dist/tensor/index.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { caseShapeValues } from '../../../../../../dist/tensor/cuda-runtime.js';

const inside = {
  layernorm: `fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
    mean[i] = sum(d) x[i,d] / D;
    centered[i,j] = x[i,j] - mean[i];
    variance[i] = sum(j) centered[i,j] * centered[i,j] / D;
    y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
    return y;
  }`,
  attention: `fn attention(q: f32[Q,D], k: f32[K,D], v: f32[K,V]): f32[Q,V] {
    score[i,j] = sum(d) q[i,d] * k[j,d] / sqrt(D);
    shift[i] = max(j) score[i,j];
    e[i,j] = exp(score[i,j] - shift[i]);
    z[i] = sum(j) e[i,j];
    o[i,c] = sum(j) e[i,j] * v[j,c] / z[i];
    return o;
  }`,
};
const corpus = name =>
  compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8')).current.value.functions.find(
    f => f.name === name,
  );

const mode = process.argv[2] ?? 'layernorm-inside';
if (mode === 'decline') {
  const fn = corpus('softmax');
  const inputs = { x: { shape: [4, 1024], data: new Float32Array(4 * 1024) } };
  const shapes = caseShapeValues(fn, inputs);
  const plan = planFusion(fn, shapes);
  console.log(JSON.stringify({ declined: plan.declined, groups: plan.groups.map(g => [g.kernel, g.mapping, g.statements]) }, null, 1));
  console.log('cudaSource kernels:', (cudaSource({ current: { value: { functions: [fn] } } }, 'softmax').match(/__global__ void/g) ?? []).length);
} else {
  const name = mode.replace('-inside', '');
  const program = compileTix(inside[name]);
  const fn = program.current.value.functions[0];
  const plan = planFusion(fn);
  console.log(
    JSON.stringify(
      {
        groups: plan.groups.map(g => ({
          kernel: g.kernel,
          mapping: g.mapping,
          statements: g.statements,
          terms: g.terms.map(t => `${t.member}:${t.op}(${t.axes})`),
          termRefusals: g.termRefusals,
        })),
        declined: plan.declined,
      },
      null,
      1,
    ),
  );
  const source = cudaSource(program, name);
  const kernel = source.slice(source.indexOf('// k0'), source.indexOf('\n\nstatic void run_case'));
  console.log(kernel);
  const split = optimizeTix(program, ['split-sum']).program;
  console.log('--- after split-sum, staged terms:', JSON.stringify(planFusion(split.current.value.functions[0]).groups[0].terms));
  console.log('--- split refusals:', JSON.stringify(planFusion(split.current.value.functions[0]).groups[0].termRefusals));
}
