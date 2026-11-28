// IRWB-053-A: the targeted measurement. Liveness runs inside the register allocator (intervals) and
// the coalescer on every function, so this probe times the machine-liveness step over real corpus
// machine code: compile the 5 biggest corpus projects under `speed`, `select` each function's machine
// code, then time `intervals(code)` (which solves liveness under 'all-blocks' and then builds the
// intervals) many rounds and report the median total per project. Run before and after the rewrite;
// dist/ holds whichever liveness is built in, so the same probe measures both.
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..', '..', '..', '..', '..', '..');
const imp = p => import(pathToFileURL(resolve(root, p)).href);

const { installVendor } = await imp('tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await imp('tools/corpus.mjs');
const { projectSource } = await imp('dist/typed/project.js');
const { Program } = await imp('dist/typed/program.js');
const { storeOf } = await imp('dist/typed/ir.js');
const { livenessAnalysis, liveView } = await imp('dist/typed/analyses.js');
const { backendDefaults } = await imp('dist/typed/backend/options.js');
const { select } = await imp('dist/typed/backend/select.js');
const { intervals } = await imp('dist/typed/backend/regalloc.js');

const ids = projectIds().filter(id => (projectFiles(id)['main.typed'] ?? '').length > 1500);
const R = 20;

// machine code per project: the selection of every function of the speed-pipelined artifact
const machine = new Map();
for (const id of ids) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  await p.pipeline('speed');
  const st = storeOf(p.artifact().value);
  const live = livenessAnalysis.solveArtifact(p.artifact());
  const code = [...st.fns.values()].map(f =>
    select({ st, f, o: backendDefaults, live: liveView(live, st, f.name), ranges: null }),
  );
  machine.set(id, code);
}

const times = new Map();
for (let r = 0; r < R; r++) {
  for (const [id, fns] of machine) {
    const t0 = performance.now();
    for (const sel of fns) intervals(sel.code);
    const dt = performance.now() - t0;
    const a = times.get(id) ?? [];
    a.push(dt);
    times.set(id, a);
  }
}
const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const label = process.argv[2] ?? 'run';
let total = 0;
for (const id of ids) {
  const m = med(times.get(id));
  total += m;
  console.log(`${label}\t${id}\t${m.toFixed(2)}ms\t${machine.get(id).length} fns`);
}
console.log(`${label}\tmedian-total\t${total.toFixed(2)}ms`);
