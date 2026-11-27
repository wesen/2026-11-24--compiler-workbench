#!/usr/bin/env node
// Why are fused layernorm and attention slower than unfused on the hidden T3 programs, when the agents measured 2-3x
// gains on the visible corpus? The hidden programs (from the T1 hidden suite) divide inside the reductions:
// `sum(d) x[i, d] / D` and `sum(j) e[i, j] * v[j, x] / l[i]`, where the visible corpus divides the reduced value.
// This probe benchmarks both placements on the same worktrees at the evaluator's large sizes, fused and unfused
// (median of three `benchmark` calls, as the evaluator does), and first confirms on small inputs that the two
// placements are different f32 programs (that Tix reads `sum(d) a / D` as the sum of a / D).
// Usage: node 43-probe-division-placement.mjs <worktree>...   Prints one line per worktree, program and placement.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const V = {
  layernorm: {
    inside: `fn layernorm(x: f32[N, D], g: f32[D], b: f32[D]): f32[N, D] {
  mu[i] = sum(d) x[i, d] / D;
  xc[i, d] = x[i, d] - mu[i];
  vr[i] = sum(d) xc[i, d] * xc[i, d] / D;
  y[i, d] = xc[i, d] / sqrt(vr[i] + 0.00001) * g[d] + b[d];
  return y;
}`,
    outside: `fn layernorm(x: f32[N, D], g: f32[D], b: f32[D]): f32[N, D] {
  mu[i] = (sum(d) x[i, d]) / D;
  xc[i, d] = x[i, d] - mu[i];
  vr[i] = (sum(d) xc[i, d] * xc[i, d]) / D;
  y[i, d] = xc[i, d] / sqrt(vr[i] + 0.00001) * g[d] + b[d];
  return y;
}`,
    params: ['x', 'g', 'b'], large: [[4096, 1024], [1024], [1024]], small: [[3, 24], [24], [24]],
  },
  attention: {
    inside: `fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  s[i, j] = sum(d) q[i, d] * k[j, d] / sqrt(D);
  m[i] = max(j) s[i, j];
  e[i, j] = exp(s[i, j] - m[i]);
  l[i] = sum(j) e[i, j];
  o[i, x] = sum(j) e[i, j] * v[j, x] / l[i];
  return o;
}`,
    outside: `fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  s[i, j] = (sum(d) q[i, d] * k[j, d]) / sqrt(D);
  m[i] = max(j) s[i, j];
  e[i, j] = exp(s[i, j] - m[i]);
  l[i] = sum(j) e[i, j];
  w[i, j] = e[i, j] / l[i];
  o[i, x] = sum(j) w[i, j] * v[j, x];
  return o;
}`,
    params: ['q', 'k', 'v'], large: [[1024, 64], [1024, 64], [1024, 64]], small: [[9, 8], [9, 8], [9, 8]],
  },
};
function inputs(spec, shapes, seed) {
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  return Object.fromEntries(spec.params.map((p, i) => {
    const n = shapes[i].reduce((a, b) => a * b, 1), data = new Float32Array(n);
    for (let j = 0; j < n; j++) data[j] = rnd() * (i === 0 ? 3 : 1);
    return [p, { shape: shapes[i], data }];
  }));
}
const median = xs => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (const wt of process.argv.slice(2)) {
  const api = await import(pathToFileURL(path.join(wt, 'dist/tensor/index.js')).href);
  for (const [name, spec] of Object.entries(V)) {
    const a = api.runTix(api.compileTix(spec.inside), name, inputs(spec, spec.small, 7)).data;
    const b = api.runTix(api.compileTix(spec.outside), name, inputs(spec, spec.small, 7)).data;
    const differ = a.some((x, i) => !Object.is(x, b[i]));
    for (const placement of ['inside', 'outside']) {
      const ms = {};
      for (const fuse of [true, false]) {
        const runs = [];
        for (let k = 0; k < 3; k++) runs.push((await api.runTixCuda(api.compileTix(spec[placement]), name, inputs(spec, spec.large, 202), { fuse, benchmark: true })).gpuMs);
        ms[fuse ? 'fused' : 'unfused'] = median(runs);
      }
      const kernels = (String(api.cudaSource(api.compileTix(spec[placement]), name)).match(/__global__/g) ?? []).length;
      console.log(`${path.basename(wt).padEnd(20)} ${name.padEnd(9)} division ${placement.padEnd(7)} fused ${ms.fused.toFixed(3)} ms (${kernels} kernels)  unfused ${ms.unfused.toFixed(3)} ms  speed-up ${(ms.unfused / ms.fused).toFixed(2)}x  [placements give different f32 results: ${differ}]`);
    }
  }
}
