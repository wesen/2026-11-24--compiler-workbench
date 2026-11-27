// IRWB-035-G tables 04: one row per project for the report: edits and the local / structural / other shares by edits,
// and the local share by instructions, for O2 and speed side by side. Markdown on stdout.
// usage: node 04-per-project-compact.mjs classified.json [more.json ...]
import { readFileSync } from 'node:fs';
const parts = process.argv.slice(2).map(f => JSON.parse(readFileSync(f, 'utf8')));
const edits = parts.flatMap(x => x.edits), projects = parts.flatMap(x => x.projects).sort();
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(0) : '-');
const cell = (p, pl) => {
  const E = edits.filter(e => e.project === p && e.pipeline === pl), n = E.length;
  const c = k => E.filter(e => e.class === k).length, w = E.reduce((a, e) => a + e.insns, 0);
  return [n, `${pct(c('local'), n)} / ${pct(c('structural'), n)} / ${pct(c('other'), n)}`, w, pct(E.filter(e => e.class === 'local').reduce((a, e) => a + e.insns, 0), w)];
};
console.log('| project | O2 edits | local / structural / other % | O2 instructions | local % | speed edits | local / structural / other % | speed instructions | local % |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const p of projects) console.log(`| ${[p, ...cell(p, 'O2'), ...cell(p, 'speed')].join(' | ')} |`);
