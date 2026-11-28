#!/usr/bin/env node
// IRWB-050-B: the before/after of Tix's evaluator, measured with 01-tix-eval-speed.mjs.
//
// This machine is shared, so wall time drifts by up to 3× between rounds. The two builds are therefore measured
// alternately, several rounds each, and compared by CPU time (user+system, which the other agents' processes do
// not enter): the minimum over the rounds, with the median beside it as the noise indicator, and wall time kept
// only to show the contention.
//
// Usage, with a saved copy of the build from before the change (`cp -r dist out/dist-before`) and the build after:
//   node 03-num-speed-compare.mjs [rounds]        (default 3)
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, '01-tix-eval-speed.mjs');
const rounds = +(process.argv[2] ?? 3);
const builds = [
  ['before', 'out/dist-before'],
  ['after', 'dist'],
];
const rows = new Map();
const key = r => `${r.program}/${r.precision}`;
for (let round = 0; round < rounds; round++)
  for (const [label, dist] of builds) {
    if (round === 0 && !rows.size) for (const k of ['softmax/f32', 'softmax/f64', 'attention/f32', 'attention/f64']) rows.set(k, {});
    for (const r of JSON.parse(execFileSync(process.execPath, [script, label], { env: { ...process.env, DIST: dist } }).toString())) {
      const row = rows.get(key(r));
      row[label] = row[label] ?? { cpuMin: Infinity, cpuMedians: [], wallMin: Infinity, wallMedians: [], output: r.output };
      row[label].cpuMin = Math.min(row[label].cpuMin, r.cpuMinMs);
      row[label].cpuMedians.push(r.cpuMedianMs);
      row[label].wallMin = Math.min(row[label].wallMin, r.wallMinMs);
      row[label].wallMedians.push(r.wallMedianMs);
      if (row[label].output !== r.output) throw new Error(`${label} ${key(r)}: output changed`);
    }
  }
const out = [];
for (const [config, row] of rows) {
  const b = row.before,
    a = row.after;
  out.push({
    config,
    beforeCpuMinMs: b.cpuMin,
    afterCpuMinMs: a.cpuMin,
    ratio: +(a.cpuMin / b.cpuMin).toFixed(3),
    cpuMediansMs: { before: b.cpuMedians, after: a.cpuMedians },
    wallMinMs: { before: b.wallMin, after: a.wallMin },
    output: a.output,
  });
}
console.log(JSON.stringify({ rounds, rows: out }, null, 2));
