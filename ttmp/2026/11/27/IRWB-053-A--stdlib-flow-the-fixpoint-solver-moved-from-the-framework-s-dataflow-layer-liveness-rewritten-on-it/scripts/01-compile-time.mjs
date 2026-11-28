// IRWB-053-A: time the corpus compile under `speed` before and after liveness was rewritten on the
// library's fixpoint solver. Liveness runs inside the register allocator and the coalescer on every
// function, so its cost shows up in the whole pipeline; this probe times the full speed pipeline
// (parse -> pipeline('speed') -> lowerToImage) per project and reports the median of R runs, plus the
// total over all projects, so the before/after numbers are comparable.
//
//   node 01-compile-time.mjs [label]      prints `label<TAB>median per project<TAB>totals`
// Run it before the change (label before) and after (label after), same checkout otherwise.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..', '..', '..', '..', '..', '..'); // scripts -> ticket -> 27 -> 11 -> 2026 -> ttmp -> repo root
const imp = p => import(pathToFileURL(resolve(root, p)).href);

const { installVendor } = await imp('tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await imp('tools/corpus.mjs');
const { projectSource } = await imp('dist/typed/project.js');
const { Program } = await imp('dist/typed/program.js');
const { lowerToImage } = await imp('dist/typed/backend/index.js');

// the projects the coordinator's baselines call "the agents' seed corpus" plus the big ones; every
// project would drown the signal in parse/print time, the larger back-half projects carry regalloc
const ids = projectIds().filter(id => {
  const files = projectFiles(id);
  const main = files['main.typed'] ?? '';
  return main.length > 1500;
});
const R = 5;

const run = async id => {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  await p.pipeline('speed');
  lowerToImage(p.artifact());
};

// warmup (JIT + caches), then timed rounds
for (const id of ids) await run(id);
const times = new Map();
for (let r = 0; r < R; r++) {
  for (const id of ids) {
    const t0 = performance.now();
    await run(id);
    const dt = performance.now() - t0;
    const a = times.get(id) ?? [];
    a.push(dt);
    times.set(id, a);
  }
}
const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const medians = ids.map(id => med(times.get(id)));
const total = medians.reduce((s, x) => s + x, 0);
const label = process.argv[2] ?? 'run';
console.log(`${label}\tmedian-total=${total.toFixed(1)}ms\tprojects=${ids.length}`);
for (let i = 0; i < ids.length; i++) console.log(`${label}\t${ids[i]}\t${medians[i].toFixed(1)}`);
