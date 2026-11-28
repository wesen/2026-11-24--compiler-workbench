#!/usr/bin/env node
// IRWB-050-B: what one min/max costs, apart from a corpus program's arithmetic.
//
// Tix's evaluator calls min/max once per element of an elementwise op and once per step of a max reduction; Typed
// calls it only while folding. This probe times the primitive itself over a large array of pairs — Math.max (the
// code Tix replaced), the library's 'minimum' profile over numbers, and a hand-inlined `a < b ? b : a` as the floor
// — so the per-pair overhead of the profile rule is visible without the evaluator's other work.
//
//   node 04-minmax-cost.mjs [pairs]       (default 20_000_000)
// Prints ns per pair, min over 5 rounds of each: a shared machine, so CPU time and the minimum again.
import { minmax, NUMBERS } from '../../../../../../dist/stdlib/index.js';

const n = +(process.argv[2] ?? 20_000_000);
const a = new Float64Array(n),
  b = new Float64Array(n);
for (let i = 0; i < n; i++) {
  a[i] = Math.sin(i * 0.5);
  b[i] = Math.cos(i * 0.7);
}
const lib = minmax('minimum', NUMBERS).max;
const inline = (x, y) => (x < y ? y : x);
const variants = { 'Math.max': Math.max, "minmax('minimum', NUMBERS).max": (x, y) => lib(x, y), 'a < b ? b : a': inline };

const cpuMs = () => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};
const best = {};
for (let round = 0; round < 5; round++)
  for (const [name, f] of Object.entries(variants)) {
    let sink = 0;
    const t0 = cpuMs();
    for (let i = 0; i < n; i++) sink += f(a[i], b[i]);
    const ms = cpuMs() - t0;
    if (sink === 12345.6789) console.log('never'); // keep the loop alive
    best[name] = Math.min(best[name] ?? Infinity, ms);
  }
for (const [name, ms] of Object.entries(best)) console.log(`${name.padEnd(32)} ${((ms * 1e6) / n).toFixed(2)} ns/pair`);
