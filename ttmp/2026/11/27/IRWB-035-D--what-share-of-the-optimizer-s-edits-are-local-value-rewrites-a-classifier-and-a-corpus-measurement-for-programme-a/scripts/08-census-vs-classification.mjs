// IRWB-035-D probe 8: are the edit records the same at the meaning check's default case count (40) as at the
// count the measurement uses (1)? Re-runs the pipelines at 1 case per function and compares the (pipeline, pass,
// kind) counts with the recorded census at 40 (various/01-edit-census-count40.txt).
//
//   node scripts/08-census-vs-classification.mjs [--census path] [--count 1]
import { readFileSync, writeFileSync } from 'node:fs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';

await installVendor();
const root = new URL('../../../../../../', import.meta.url).pathname;
const { projectSource, ingestProject, runPipeline } = await import(root + 'dist/typed/project.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const censusPath = flag('--census', new URL('../various/01-edit-census-count40.txt', import.meta.url).pathname);
const COUNT = +flag('--count', 1);
const outPath = flag('--out', '');

const census = new Map();
for (const line of readFileSync(censusPath, 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f.length !== 4 || !/^\d+$/.test(f[3])) continue;
  census.set(f.slice(0, 3).join('\t'), Number(f[3]));
}

const now = new Map();
const bump = k => now.set(k, (now.get(k) ?? 0) + 1);
for (const id of projectIds()) {
  const p = projectSource(id, projectFiles(id));
  const r0 = ingestProject(p);
  for (const pipeline of ['O2', 'speed']) {
    const roots = p.meta.entries ? { roots: p.meta.entries } : {};
    const run = await runPipeline(r0, pipeline, { manager: new AnalysisManager(), inputs: p.meta.inputs, count: COUNT, ...roots });
    for (const step of run.steps) {
      const edits = step.report?.edits ?? [];
      for (const e of edits) bump(`${pipeline}\t${e.pass}\t${e.kind}`);
    }
  }
}

const keys = [...new Set([...census.keys(), ...now.keys()])].sort();
const differ = keys.filter(k => (census.get(k) ?? 0) !== (now.get(k) ?? 0));
const lines = [
  `# edit records at count ${COUNT} versus the census at 40`,
  '',
  `keys: ${keys.length}, differing: ${differ.length}`,
  '',
  ...differ.map(k => `${k}\tcount40=${census.get(k) ?? 0}\tcount${COUNT}=${now.get(k) ?? 0}`),
  '',
  `totals: count40=${[...census.values()].reduce((a, b) => a + b, 0)} count${COUNT}=${[...now.values()].reduce((a, b) => a + b, 0)}`,
];
const text = lines.join('\n') + '\n';
if (outPath) writeFileSync(outPath, text);
process.stdout.write(text);
process.exit(differ.length ? 1 : 0);
