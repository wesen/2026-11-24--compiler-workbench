// IRWB-030-F script 01: inspect the staged plan and the emitted CUDA for the inside placements, and the gate's
// decision at small shapes. CPU only.
//   node ttmp/2026/11/27/IRWB-030-F--*/scripts/01-staged-plan.mjs [program]
import { readFileSync } from 'node:fs';
import { compileTix, cudaSource, optimizeTix } from '../../../../../../dist/tensor/index.js';
import { gatedPlan, planFusion } from '../../../../../../dist/tensor/fusion.js';

const inside = {
  layernorm: `fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
  mean[i] = sum(d) x[i,d] / D;
  centered[i,j] = x[i,j] - mean[i];
  variance[i] = sum(d) centered[i,d] * centered[i,d] / D;
  y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
  return y;
}`,
  attention: `fn attention(q: f32[Q,D], k: f32[K,D], v: f32[K,V]): f32[Q,V] {
  s[i,j] = sum(d) q[i,d] * k[j,d] / sqrt(D);
  m[i] = max(j) s[i,j];
  e[i,j] = exp(s[i,j] - m[i]);
  l[i] = sum(j) e[i,j];
  o[i,c] = sum(j) e[i,j] * v[j,c] / l[i];
  return o;
}`,
  split: `fn f(x: f32[N,K]): f32[N,K] { s[i] = sum(k) x[i,k] * x[i,k]; y[i,k] = x[i,k] - s[i]; return y; }`,
};

for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(inside)) {
  const program = compileTix(inside[name]);
  let fn = program.current.value.functions[0];
  if (name === 'split') fn = optimizeTix(program, ['split-sum']).program.current.value.functions[0];
  const plan = planFusion(fn);
  console.log('==', name);
  for (const g of plan.groups) {
    console.log(g.kernel, g.mapping, 'depth', g.depth, JSON.stringify(g.parallelTerms));
    for (const r of g.reasons) console.log('  reason:', r);
  }
  if (name === 'split') {
    const gated = gatedPlan(fn, new Map([['N', 4], ['K', 3]]));
    console.log('gate at N=4,K=3:', gated.groups.map(g => [g.kernel, g.mapping, g.statements.join(',')]));
    console.log('refusals:', gated.refusals);
  }
  if (name === 'layernorm') {
    const source = cudaSource({ origin: program.origin, current: { ...program.current, value: { functions: [fn] } } }, 'layernorm');
    const i = source.indexOf('template <bool Shared, bool Staged>');
    console.log(source.slice(i, i + 2200));
  }
}
