// IRWB-030-D: summarize a benchmark .jsonl. node 07-summarize.mjs <file> <key,key,...>: groups the rows by the
// keys (shape is printed compactly) and prints the median gpuMs over the rounds, the rounds, and the output digests.
import { readFileSync } from 'node:fs';
const [file, keys] = process.argv.slice(2);
const rows = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const groups = new Map();
const show = v => (v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => k + '=' + x).join(',') : String(v));
for (const r of rows) {
  const key = keys.split(',').map(k => show(r[k])).join('  ');
  groups.set(key, [...(groups.get(key) ?? []), r]);
}
for (const [key, rs] of groups) {
  const ms = rs.map(r => r.gpuMs).sort((a, b) => a - b);
  console.log(
    `${key}  median ${ms[Math.floor(ms.length / 2)].toFixed(3)}  (${rs.map(r => r.gpuMs.toFixed(3)).join(', ')})  ${[...new Set(rs.map(r => r.sha))].join(',')}`,
  );
}
