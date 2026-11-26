// node 02-read-probe.mjs /path/to/out/grid.bin
import { readFileSync } from 'node:fs';
const data = readFileSync(process.argv[2]);
if (data.length !== 16385 * 6 * 4) throw Error('Incomplete grid');
const words = n => { const b = Buffer.alloc(4); b.writeFloatLE(n); return b.readUInt32LE().toString(16); };
const names = ['exp', 'log', 'sqrt', 'tanh', 'softmax7', 'dot7'];
const stats = names.map(op => ({ op, bitDiff: 0, maxAbs: 0, maxBudgetFraction: 0, first: null }));
function reference(x, round) {
  let z = 0, dot = 0, last;
  for (let j = 0; j < 7; j++) {
    const a = round(round(x + (j - 3)) / 11);
    last = round(Math.exp(round(a - 1)));
    z = round(z + last);
    dot = round(dot + round(a * ((j & 1) ? -0.75 : 0.5)));
  }
  return [Math.exp(x), Math.log(9 + x), Math.sqrt(9 + x), Math.tanh(x), round(last / z), dot].map(round);
}
for (let i = 0; i < 16385; ++i) {
  const x = (i - 8192) / 1024, f32 = reference(x, Math.fround), f64 = reference(x, x => x);
  stats.forEach((s, j) => {
    const got = data.readFloatLE(4 * (6 * i + j));
    const abs = Math.abs(got - f64[j]);
    s.maxAbs = Math.max(s.maxAbs, abs);
    s.maxBudgetFraction = Math.max(s.maxBudgetFraction, abs / (2e-6 + 2e-5 * Math.abs(f64[j])));
    if (words(got) === words(f32[j])) return;
    s.bitDiff++;
    s.first ??= { x, js: words(f32[j]), gpu: words(got) };
  });
}
console.log(JSON.stringify(stats, null, 2));
if (!stats.every(s => s.maxBudgetFraction <= 1)) process.exitCode = 1;
