#!/usr/bin/env node
// Each stage-2 implementer's own evaluation results as text, for its report turn (prompts/t2/turn3.md).
// Usage: node 19-t2-results.mjs <eval-t2.json> <out-dir>
import fs from 'node:fs';
import path from 'node:path';
const [file, outDir] = process.argv.slice(2);
const T = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const key = JSON.parse(fs.readFileSync(path.join(T, 'various/results/t2-config-key.json'), 'utf8'));
const res = JSON.parse(fs.readFileSync(file, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const e = x => (x === 0 ? '0' : x.toExponential(1));
const line = (name, x) => x.error ? `${name}: error (${x.error.slice(0, 160)})` : `${name}: ${x.bitExact}/${x.n} elements bit-identical to the f32 meaning, largest difference ${e(x.max32)} (scaled by max(1, |r|))${x.max64 ? `, largest difference from f64 ${e(x.max64)}` : ''}`;
for (const [wt, r] of Object.entries(res)) {
  const item = 'IRWB-' + wt.match(/irwb-(\d+-[a-l])$/)[1].toUpperCase();
  const L = [];
  L.push('- **Stage-1 hidden suite:** 25/25 passed. The three API functions are exported.');
  L.push('- **Corpus programs, small sizes, through `runTixCuda`:**');
  for (const [n, x] of Object.entries(r.corpus)) L.push(`  - ${line(n, x)}`);
  L.push("- **After `optimizeTix(p, ['inline', 'split-sum'])`, compared with your own f32 run of the optimized program:**");
  for (const [n, x] of Object.entries(r.optimized)) L.push(`  - ${line(n, x)}`);
  const rx = r.random.filter(x => x.shapeOk && x.bitExact === x.n).length;
  const rw = Math.max(0, ...r.random.filter(x => x.shapeOk).map(x => x.max32));
  L.push(`- **20 random programs from the fixed core:** ${rx}/20 bit-identical to the f32 meaning on every element; largest difference ${e(rw)}.`);
  L.push('- **Corpus at the brief\'s sizes:**');
  for (const [n, x] of Object.entries(r.large)) L.push(`  - ${line(n, x)}; your \`gpuMs\` ${x.gpuMs != null ? (+x.gpuMs).toFixed(3) : '-'}`);
  const ch = Object.values(r.check);
  L.push(`- **\`checkLowering\` on the six corpus programs and ten random ones:** accepted ${ch.filter(c => c.accepted).length}/16, relation ${[...new Set(ch.map(c => c.relation))].join(', ')}, ${(ch.reduce((a, c) => a + c.ms, 0) / 16000).toFixed(1)} s per check on average.`);
  L.push('- **Independently of your work,** the coordinator compared CUDA\'s double-precision `exp`, `log` and `tanh`, rounded to f32 (`__double2float_rn(exp((double)x))` and so on), with the f32 meaning\'s `Math.fround(Math.exp(x))` and so on, for all 2³² f32 inputs on the GB10. They agree on every input, with NaN compared as a class. In IEEE mode, `+ − * /` and `sqrtf` are correctly rounded, and the f32 meaning rounds each of them in the same way.');
  fs.writeFileSync(path.join(outDir, `${item}.md`), L.join('\n') + '\n');
}
console.log('wrote', Object.keys(res).length);
