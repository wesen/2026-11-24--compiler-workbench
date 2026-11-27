#!/usr/bin/env node
// T9: how noisy is `runTixCuda(..., { benchmark: true })` on the GB10, and how many calls give a stable median?
// One session: for each corpus-shaped program (the T3 hidden set at the brief's sizes, plus log-softmax), K benchmark
// calls fused and K unfused, alternating fused/unfused and cycling over programs so that slow drift hits all alike.
// Each call is itself a warm-up launch plus the median of three timed launches, under the tool's GPU lock.
// Records every call's gpuMs, and the GPU's SM clock, temperature and power before, midway and after (nvidia-smi).
// Prints per program and side: median, coefficient of variation, min/max ratio, and for k = 1, 3, 5, 7 calls the share of
// random k-subsets whose median falls within 2% and 5% of the K-call median.
// Usage: node 53-t9-timing-spread.mjs <worktree> <out.json> [K=12]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const [wt, outFile, kArg] = process.argv.slice(2);
const K = Number(kArg ?? 12);
const api = await import(pathToFileURL(path.join(wt, 'dist/tensor/index.js')).href);
const T1 = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'various', 'hidden-t1', 'acceptance.test.mjs');
const SRC = new Function(`return ${fs.readFileSync(T1, 'utf8').match(/const SRC = (\{[\s\S]*?\n\});/)[1]}`)();
SRC.logsoftmax = `fn logsoftmax(x: f32[N, C]): f32[N, C] {
  m[i] = max(j) x[i, j];
  s[i] = sum(j) exp(x[i, j] - m[i]);
  y[i, j] = x[i, j] - m[i] - log(s[i]);
  return y;
}`;
const PARAMS = { matmul: ['a', 'b'], softmax: ['x'], layernorm: ['x', 'g', 'b'], attention: ['q', 'k', 'v'], mlp: ['x', 'w1', 'b1', 'w2', 'b2'], conv: ['a', 'w'], logsoftmax: ['x'] };
const LARGE = { matmul: [[512, 512], [512, 512]], softmax: [[4096, 1024]], layernorm: [[4096, 1024], [1024], [1024]], attention: [[1024, 64], [1024, 64], [1024, 64]], mlp: [[1024, 256], [256, 1024], [1024], [1024, 256], [256]], conv: [[8, 16, 64, 64], [32, 16, 3, 3]], logsoftmax: [[4096, 1024]] };
const inputs = name => {
  let s = 202;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  return Object.fromEntries(PARAMS[name].map((p, i) => {
    const n = LARGE[name][i].reduce((a, b) => a * b, 1), data = new Float32Array(n);
    for (let j = 0; j < n; j++) data[j] = rnd() * (i === 0 ? 3 : 1);
    return [p, { shape: LARGE[name][i], data }];
  }));
};
const gpu = () => {
  try { return execFileSync('ssh', ['manuel@bling', 'nvidia-smi --query-gpu=clocks.sm,clocks.max.sm,temperature.gpu,power.draw --format=csv,noheader'], { encoding: 'utf8', timeout: 20000 }).trim(); }
  catch (e) { return 'unavailable: ' + String(e.message).slice(0, 80); }
};
const names = Object.keys(SRC);
const progs = Object.fromEntries(names.map(n => [n, { p: api.compileTix(SRC[n]), inp: inputs(n) }]));
const calls = Object.fromEntries(names.flatMap(n => [[n + ':fused', []], [n + ':unfused', []]]));
const clock = [{ at: 'start', gpu: gpu() }];
const t0 = Date.now();
for (let k = 0; k < K; k++) {
  if (k === Math.floor(K / 2)) clock.push({ at: 'mid', gpu: gpu() });
  for (const n of names) for (const fuse of k % 2 ? [false, true] : [true, false]) {
    const r = await api.runTixCuda(progs[n].p, n, progs[n].inp, { fuse, benchmark: true });
    calls[n + (fuse ? ':fused' : ':unfused')].push(r.gpuMs);
  }
}
clock.push({ at: 'end', gpu: gpu() });
const median = xs => { const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
let seed = 7;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
const stable = (xs, k, tol) => {
  const ref = median(xs);
  let hit = 0;
  for (let t = 0; t < 2000; t++) {
    const pick = [];
    const pool = xs.slice();
    for (let i = 0; i < k; i++) pick.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    if (Math.abs(median(pick) - ref) / ref <= tol) hit++;
  }
  return hit / 2000;
};
const summary = {};
for (const [key, xs] of Object.entries(calls)) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
  summary[key] = { median: median(xs), cv: sd / mean, maxOverMin: Math.max(...xs) / Math.min(...xs),
    within2: Object.fromEntries([1, 3, 5, 7].map(k => [k, stable(xs, k, 0.02)])), within5: Object.fromEntries([1, 3, 5, 7].map(k => [k, stable(xs, k, 0.05)])) };
  const s = summary[key];
  console.log(`${key.padEnd(20)} median ${s.median.toFixed(4)} ms  cv ${(100 * s.cv).toFixed(1)}%  max/min ${s.maxOverMin.toFixed(2)}  within 2%: k1 ${s.within2[1].toFixed(2)} k3 ${s.within2[3].toFixed(2)} k5 ${s.within2[5].toFixed(2)} k7 ${s.within2[7].toFixed(2)}  within 5%: k1 ${s.within5[1].toFixed(2)} k3 ${s.within5[3].toFixed(2)}`);
}
console.log('gpu (sm clock, max sm clock, temperature, power):', clock.map(c => `${c.at}: ${c.gpu}`).join(' | '), `| ${((Date.now() - t0) / 1000).toFixed(0)} s`);
fs.writeFileSync(outFile, JSON.stringify({ worktree: wt, K, calls, summary, clock, seconds: (Date.now() - t0) / 1000 }, null, 1));
