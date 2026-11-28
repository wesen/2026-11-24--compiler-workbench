#!/usr/bin/env node
// IRWB-051-C script 03: milliseconds per `manager.analyse` on a cache miss and on a cache hit, and (when the build
// has it) per `manager.analyseSync`. Run on the base commit and on the prototype to see what the generator costs
// the existing asynchronous callers.
//   node 03-bench-analyse.mjs [rounds=7]      (after npm run build)
//   DIST=.base-build/dist node 03-bench-analyse.mjs      a build of the base commit, made with
//     mkdir .base-build && git archive 3ba86fc src tsconfig.json | tar -x -C .base-build && npx tsc -p .base-build/tsconfig.json
// Each figure is CPU time of this process (other agents load the machine): the median over `rounds` of a batch
// mean, and min..max of the batch means.
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const imp = p => import(pathToFileURL(resolve(root, p)).href);
const rounds = Number(process.argv[2] ?? 7);
const dist = process.env.DIST ?? 'dist';
const { installVendor } = await imp('tools/node-vendor.mjs');
await installVendor();
// the front end is installed into dist's typed domain; a second build needs it in its own module instances
if (dist !== 'dist') {
  const { setVendor } = await imp(dist + '/typed/vendor.js');
  setVendor({ typedTape: globalThis.typedTape, typedWasm: globalThis.typedWasm, typedRv32Interp: globalThis.typedRv32Interp });
}
const { projectFiles } = await imp('tools/corpus.mjs');
const { projectSource } = await imp(dist + '/typed/project.js');
const { Program } = await imp(dist + '/typed/program.js');
const A = await imp(dist + '/typed/analyses.js');
const { AnalysisManager } = await imp(dist + '/framework/contracts/index.js');

const art = Program.fromProject(projectSource('sha-chacha', projectFiles('sha-chacha'))).artifact();
const stat = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return `${s[s.length >> 1].toFixed(4)} ms (${s[0].toFixed(4)}..${s.at(-1).toFixed(4)})`;
};
const cpuMs = () => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};
async function bench(label, n, make) {
  const means = [];
  for (let r = 0; r < rounds + 1; r++) {
    const jobs = Array.from({ length: n }, make);
    const t0 = cpuMs();
    for (const job of jobs) await job();
    if (r) means.push((cpuMs() - t0) / n); // round 0 warms up
  }
  console.log(label.padEnd(58), stat(means));
}
const hasSync = typeof AnalysisManager.prototype.analyseSync === 'function';
for (const [name, def, n] of [
  ['typed.cfg', A.cfgAnalysis, 200],
  ['typed.ranges', A.rangesAnalysis, 20],
]) {
  await bench(`analyse ${name}, miss (new manager)`, n, () => {
    const m = new AnalysisManager();
    return () => m.analyse(def, art);
  });
  if (hasSync)
    await bench(`analyseSync ${name}, miss (new manager)`, n, () => {
      const m = new AnalysisManager();
      return () => m.analyseSync(def, art);
    });
  const m = new AnalysisManager();
  await m.analyse(def, art);
  await bench(`analyse ${name}, hit`, 200, () => () => m.analyse(def, art));
  if (hasSync) await bench(`analyseSync ${name}, hit`, 200, () => () => m.analyseSync(def, art));
}
