#!/usr/bin/env node
// IRWB-057 probe 02: what scheduling a function costs, before and after this step.
//   node 02-schedule-cost.mjs [dist]      dist defaults to this checkout's; pass a build of ab23152 for "before"
// Per corpus program: milliseconds to schedule it fused (median of 15 runs; each run a fresh copy of the function,
// so the memo in strategy.ts does not answer), and the number of framework pass applications.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../../..');
const dist = resolve(process.argv[2] ?? resolve(root, 'dist'));
const imp = p => import(pathToFileURL(resolve(dist, p)).href);
const T = await imp('tensor/index.js');
const strategy = await imp('tensor/strategy.js');
const fusion = await imp('tensor/fusion.js');
const before = strategy.scheduleFunction.length === 3; // (fn, plan, fuse) at ab23152
const rows = [];
for (const name of readdirSync(resolve(root, 'corpus/tensor'))) {
  const text = readFileSync(resolve(root, 'corpus/tensor', name, 'main.tix'), 'utf8');
  const times = [];
  let applications;
  for (let i = 0; i < 15; i++) {
    // the memo in strategy.ts keys the function as JSON, so each run schedules a renamed copy
    const fn = { ...T.compileTix(text).current.value.functions[0], name: `${name}_${i}` };
    const t0 = performance.now();
    const r = before ? strategy.scheduleFunction(fn, fusion.planFusion(fn), true) : strategy.scheduleFunction(fn, true);
    times.push(performance.now() - t0);
    applications = before
      ? r.steps.length
      : r.execution.records.filter(x => x.kind === 'apply').length;
  }
  times.sort((a, b) => a - b);
  rows.push({ program: name, ms: +times[7].toFixed(2), applications });
}
console.log(before ? 'before (per-step passes)' : 'after (two plan transformations)');
console.table(rows);
