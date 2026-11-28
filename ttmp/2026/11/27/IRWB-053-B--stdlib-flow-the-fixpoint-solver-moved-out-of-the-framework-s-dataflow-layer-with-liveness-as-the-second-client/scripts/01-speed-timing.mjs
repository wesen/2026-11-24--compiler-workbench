#!/usr/bin/env node
// IRWB-053-B probe 01: corpus compile time under `speed`, before and after liveness is rewritten on the
// library's fixpoint solver. Liveness runs in the register allocator and the coalescer on every function,
// so the whole `speed` build of a project is the measurement that matters.
//
//   node 01-speed-timing.mjs [runs] [project...]
//
// For every corpus project it builds a fresh Program and runs `pipeline('speed')`, timing the pipeline
// call only; the minimum over `runs` (default 5) is reported per project, because the machine is shared
// and one slow run says nothing. Total is the sum of the per-project minima. Needs `npm run build` first.
import { performance } from 'node:perf_hooks';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** The checkout: the nearest ancestor of this script holding package.json. */
const checkout = dir => {
  let d = dir;
  while (!existsSync(resolve(d, 'package.json'))) d = dirname(d);
  return d;
};
const root = checkout(here);
const imp = p => import(pathToFileURL(resolve(root, p)).href);

const [runsArg = '5', ...only] = process.argv.slice(2);
const runs = Number(runsArg);

const { installVendor } = await imp('tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await imp('tools/corpus.mjs');
const { projectSource } = await imp('dist/typed/project.js');
const { Program } = await imp('dist/typed/program.js');

const ids = only.length ? only : projectIds();
let total = 0;
for (const id of ids) {
  const build = () => Program.fromProject(projectSource(id, projectFiles(id)));
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const p = build();
    const t0 = performance.now();
    await p.pipeline('speed');
    best = Math.min(best, performance.now() - t0);
  }
  total += best;
  console.log(`${id}\t${best.toFixed(2)}`);
}
console.log(`total\t${total.toFixed(2)}\tms (sum of ${runs}-run minima, ${ids.length} projects)`);
