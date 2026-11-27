// IRWB-030-D: a fused-against-unfused table from a series .jsonl (scripts 06 and 10): per label and shape, the
// median over rounds of fused and unfused GPU ms, their ratio, and whether the output digests agree.
import { readFileSync } from 'node:fs';
const rows = readFileSync(process.argv[2], 'utf8').trim().split('\n').map(l => JSON.parse(l));
const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
const m = new Map();
for (const r of rows) {
  const k = `${r.label} | ${Object.entries(r.shape).map(([a, b]) => a + '=' + b).join(', ')}`;
  const e = m.get(k) ?? { f: [], u: [], s: new Set() };
  (r.fuse ? e.f : e.u).push(r.gpuMs);
  e.s.add(r.sha);
  m.set(k, e);
}
console.log('| Series | Shape | Fused ms (rounds) | Unfused ms (rounds) | Unfused / fused | Digests |');
console.log('| --- | --- | --- | --- | ---: | --- |');
const show = a => `${med(a).toFixed(3)} (${a.map(x => x.toFixed(3)).join(', ')})`;
for (const [k, e] of m)
  console.log(`| ${k} | ${show(e.f)} | ${show(e.u)} | ${(med(e.u) / med(e.f)).toFixed(2)} | ${e.s.size === 1 ? 'equal' : 'DIFFER'} |`);
