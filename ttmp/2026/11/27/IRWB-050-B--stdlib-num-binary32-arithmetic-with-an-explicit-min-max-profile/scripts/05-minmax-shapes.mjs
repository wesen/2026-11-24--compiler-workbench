#!/usr/bin/env node
// IRWB-050-B: is the profile rule or the JavaScript call what costs? Three shapes of the same max over numbers,
// timed over the same pairs, plus the number domain's own `less` predicate as a candidate simplification of
// FloatOrder (a strict order predicate instead of `compare`'s -1/0/1).
//
//   node 05-minmax-shapes.mjs [pairs]
// Prints ns per pair, minimum over 5 rounds. If the shapes are within the run-to-run spread, the rule is free and the
// call is the cost — which is what ./04-minmax-cost.mjs then says with a plain inline arrow.
import { minmax, NUMBERS } from '../../../../../../dist/stdlib/index.js';

const n = +(process.argv[2] ?? 20_000_000);
const a = new Float64Array(n),
  b = new Float64Array(n);
for (let i = 0; i < n; i++) {
  a[i] = Math.sin(i * 0.5);
  b[i] = Math.cos(i * 0.7);
}
// the same rule as minmax('minimum', NUMBERS), written against a `less` predicate instead of `compare`
const less = (x, y) => x < y || (x === y && Object.is(x, -0));
const lessMax = (x, y) => (x !== x || y !== y ? NaN : less(x, y) ? y : x);
const lib = minmax('minimum', NUMBERS).max;
// a closure with no rule at all: how much does the rule itself cost?
const plain = (x, y) => (x < y ? y : x);
const variants = {
  'minmax (compare)': (x, y) => lib(x, y),
  'less predicate': lessMax,
  'no rule (plain)': plain,
};

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
    if (sink === 12345.6789) console.log('never');
    best[name] = Math.min(best[name] ?? Infinity, ms);
  }
for (const [name, ms] of Object.entries(best)) console.log(`${name.padEnd(20)} ${((ms * 1e6) / n).toFixed(2)} ns/pair`);
