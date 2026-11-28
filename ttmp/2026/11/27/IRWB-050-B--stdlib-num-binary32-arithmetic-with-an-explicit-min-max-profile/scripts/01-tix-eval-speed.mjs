#!/usr/bin/env node
// IRWB-050-B: how fast is Tix's evaluator, before and after moving min/max into src/stdlib/num.
//
// The evaluator (src/tensor/evaluate.ts) runs inside every meaning check — the contract evaluates the
// candidate and the baseline on every generated case (src/tensor/contract.ts:70, :77, :149) — so a
// slower evaluator slows every checked pass. Tix computes `min`/`max` with JavaScript's Math.min/Math.max
// today; the library replaces those with a profile-parameterized primitive ('ieee': NaN propagates).
//
// Usage (after `npm run build`):
//   node 01-tix-eval-speed.mjs <label>
// DIST=<dir> picks the build to measure (default `dist`), so the same script measures a saved copy of the
// build from before the change (`cp -r dist out/dist-before`) beside the build from after it. Run it a
// few times on each and compare the per-config minima: this machine is shared, so the medians drift.
// Prints one JSON row per (program, precision): milliseconds of CPU (user+system) and of wall time per
// evaluate() call — min and median over the repetitions — and a hash of the output, so a behaviour change would
// show up beside a timing change. CPU time is the number to compare: this machine is shared, and wall time carries
// the other agents' load (the wall minima and medians below differ by up to 3× between rounds).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.env.ROOT ?? resolve(here, '../../../../../..'));
const imp = p => import(pathToFileURL(resolve(root, p)).href);
const label = process.argv[2] ?? 'unlabelled';

const dist = process.env.DIST ?? 'dist';
const T = await imp(dist + '/tensor/index.js');
const buf = (shape, f) => ({ shape, data: Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, (_, i) => f(i)) });
const noise = i => Math.sin(i * 12.9898) * 0.5; // a deterministic pseudo-random input, no RNG
const programs = {
  softmax: {
    fn: 'softmax',
    inputs: { x: buf([64, 256], noise) }, // 16K elements, 64 reductions of 256: the max path dominates
  },
  attention: {
    fn: 'attention',
    inputs: { q: buf([32, 64], noise), k: buf([32, 64], noise), v: buf([32, 64], noise) },
  },
};
const hash = d => createHash('sha256').update(Buffer.from(Float32Array.from(d).buffer)).digest('hex').slice(0, 16);
const median = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const cpuMs = () => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};

const rows = [];
for (const [name, { fn, inputs }] of Object.entries(programs)) {
  const p = T.compileTix(readFileSync(resolve(root, 'corpus/tensor', name, 'main.tix'), 'utf8'));
  for (const precision of ['f32', 'f64']) {
    const run = () => T.runTix(p, fn, inputs, { precision });
    for (let i = 0; i < 3; i++) run(); // warm up the JIT
    // time one call at a time; the evaluator is ~ms, so a batch would hide nothing but would blur the median
    const reps = +(process.env.REPS ?? 30);
    const wall = [],
      cpu = [];
    let out;
    for (let i = 0; i < reps; i++) {
      const t0 = process.hrtime.bigint(),
        c0 = cpuMs();
      out = run();
      cpu.push(cpuMs() - c0);
      wall.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    rows.push({
      label,
      dist,
      program: name,
      precision,
      reps,
      cpuMinMs: +Math.min(...cpu).toFixed(3),
      cpuMedianMs: +median(cpu).toFixed(3),
      wallMinMs: +Math.min(...wall).toFixed(3),
      wallMedianMs: +median(wall).toFixed(3),
      output: hash(out.data),
    });
  }
}
console.log(JSON.stringify(rows, null, 2));
