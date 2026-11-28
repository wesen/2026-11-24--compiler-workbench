#!/usr/bin/env node
// IRWB-053-B probe 03: the liveness primitive itself on the machine code the corpus actually produces.
// For every function of every corpus project this selects the backend's code (`select`, so the input is the
// real `MInsn[]` of a function, not a synthetic shape) and then times `intervals(code)` — the register
// allocator's one liveness client — from the pre-change build and from this one, interleaved, minimum of n
// rounds so contention on a shared machine hits both equally. The two results are compared for equality.
//
//   node 03-liveness-timing.mjs [runs] [repeat]
//
// The corpus is 135 functions and one pass over them is a few milliseconds, so the timed region runs the
// whole set `repeat` times (default 30, about 0.2 s per round): a 7 ms measurement is noise, not a ratio.
//
// The old build is `out/dist.old` (`git checkout HEAD~1 -- src && tsc --outDir out/dist.old`).
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const checkout = d => {
  let x = d;
  while (!existsSync(join(x, 'package.json'))) x = dirname(x);
  return x;
};
const root = checkout(here);
const imp = p => import(pathToFileURL(resolve(root, p)).href);
const OLD = process.env.OLD ?? 'out/dist.old';
const runs = Number(process.argv[2] ?? '5'),
  repeat = Number(process.argv[3] ?? '30');

const oldIntervals = (await imp(`${OLD}/typed/backend/regalloc.js`)).intervals;
const newIntervals = (await imp('dist/typed/backend/regalloc.js')).intervals;
const { installVendor } = await imp('tools/node-vendor.mjs');
await installVendor();
const { projectSource, ingestProject } = await imp('dist/typed/project.js');
const { projectFiles, projectIds } = await imp('tools/corpus.mjs');
const { storeOf } = await imp('dist/typed/ir.js');
const { select } = await imp('dist/typed/backend/select.js');
const { backendDefaults } = await imp('dist/typed/backend/options.js');
const A = await imp('dist/typed/analyses.js');

/** The selected machine code of every corpus function — the regalloc's real input. */
const codes = [];
for (const id of projectIds()) {
  const art = ingestProject(projectSource(id, projectFiles(id)));
  const st = storeOf(art.value);
  const live = A.livenessAnalysis.solveArtifact(art);
  for (const f of st.fns.values())
    codes.push(select({ st, f, o: backendDefaults, live: A.liveView(live, st, f.name), ranges: null }).code);
}
console.error(`${codes.length} functions from ${projectIds().length} corpus projects`);

const same = (a, b) =>
  a.list.length === b.list.length &&
  a.list.every((x, i) => x.reg === b.list[i].reg && x.start === b.list[i].start && x.end === b.list[i].end) &&
  a.liveOut.length === b.liveOut.length &&
  a.liveOut.every(
    (xs, i) => xs.size === b.liveOut[i].size && [...xs].every(x => b.liveOut[i].has(x)),
  );

const best = { old: Infinity, new: Infinity };
for (let i = 0; i < runs; i++) {
  for (const [name, fn] of i % 2 ? [['new', newIntervals], ['old', oldIntervals]] : [['old', oldIntervals], ['new', newIntervals]]) {
    const t0 = performance.now();
    let results = [];
    for (let r = 0; r < repeat; r++) results = codes.map(code => fn(code));
    best[name] = Math.min(best[name], (performance.now() - t0) / repeat);
    if (i === 0 && name === 'new')
      results.forEach((r, k) => {
        if (!same(r, oldIntervals(codes[k]))) throw new Error(`function ${k}: intervals differ`);
      });
  }
}
console.log(
  `intervals() over the corpus (one pass)\told ${best.old.toFixed(3)} ms\tnew ${best.new.toFixed(3)} ms\t` +
    `${(((best.new - best.old) / best.old) * 100).toFixed(1)}%`,
);
console.log(`all ${codes.length} functions give the same intervals and live-out sets in both builds`);
