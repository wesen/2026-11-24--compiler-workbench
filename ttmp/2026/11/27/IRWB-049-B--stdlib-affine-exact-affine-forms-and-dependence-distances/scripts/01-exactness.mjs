#!/usr/bin/env node
// IRWB-049-B probe: what `add` computed in doubles (the old code, reimplemented here) against what it
// computes exactly now, on the case R3 found (a scale whose product leaves the safe integers, then a
// sum that comes back inside them) and on the results that must still be rejected.
//   node 01-exactness.mjs      (needs `npm run build`; run from anywhere)
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const { add, constant, variable } = await import(
  pathToFileURL(resolve(root, 'dist/stdlib/affine/forms.js')).href
);

const M = Number.MAX_SAFE_INTEGER;
// The old code: terms and the constant combined in doubles, then one safe-integer check.
const old = (a, b, scale = 1) => {
  const terms = new Map(a.terms);
  for (const [name, k] of b.terms) terms.set(name, (terms.get(name) ?? 0) + k * scale);
  const result = {
    constant: a.constant + b.constant * scale,
    terms: [...terms].filter(([, k]) => k !== 0).sort(([x], [y]) => (x < y ? -1 : 1)),
  };
  if (![result.constant, ...result.terms.map(([, k]) => k)].every(Number.isSafeInteger))
    throw Error('Affine integer overflow');
  return result;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const big = 4503599627370497; // 2^52 + 1
const exact = Number(3n * BigInt(big) - BigInt(M));
console.log('case R3 found: add(constant(-MAX_SAFE_INTEGER), constant(2^52 + 1), 3)');
console.log('  exact            ', exact);
console.log('  old (doubles)    ', old(constant(-M), constant(big), 3).constant);
console.log('  now (BigInt)     ', add(constant(-M), constant(big), 3).constant);

// A term coefficient whose exact product is not a safe integer: the double product rounds first.
const term = index => ({ constant: 0, terms: [['x', index]] });
const reject = (label, f) => {
  try {
    const r = f();
    console.log(`  ${label}: ACCEPTED ${JSON.stringify(r)}`);
  } catch (e) {
    console.log(`  ${label}: rejected (${e.message})`);
  }
};
console.log('results that must still be rejected:');
reject('add(constant(MAX_SAFE_INTEGER), constant(1))', () => add(constant(M), constant(1)));
reject('add(constant(0), constant(MAX_SAFE_INTEGER), 2)', () => add(constant(0), constant(M), 2));
reject('add(constant(0), term(x, 3), 3002399751580331): exact 3·3002399751580331 = MAX+2', () =>
  add(constant(0), term(3), 3002399751580331),
);
console.log('  double 3 · 3002399751580331 =', 3 * 3002399751580331, '(rounds to MAX_SAFE_INTEGER + 1)');
console.log('results that must be accepted, exactly:');
for (const [label, f] of [
  ['add(constant(MAX_SAFE_INTEGER - 1), constant(1))', () => add(constant(M - 1), constant(1))],
  ['add(constant(MAX_SAFE_INTEGER), constant(0))', () => add(constant(M), constant(0))],
  ['add(constant(0), term(x, 3), 3002399751580330)', () => add(constant(0), term(3), 3002399751580330)],
  ['add(term(x, -1), term(x, 1)) → the zero form', () => add(term(-1), term(1))],
  ['add(term(x, 4503599627370497), term(x, -4503599627370497))', () => add(term(4503599627370497), term(-4503599627370497))],
]) console.log(`  ${label}: ${JSON.stringify(f())}`);

console.log('agreement of the two implementations on the corpus-relevant domain:');
let agree = 0,
  differ = 0;
const values = [-M, -M + 1, -4503599627370497, -1, 0, 1, 3, 4503599627370497, M - 1, M];
for (const a of values)
  for (const b of values)
    for (const scale of [-3, -1, 0, 1, 2, 3]) {
      const f = x => add(constant(a), constant(b), x);
      const g = x => old(constant(a), constant(b), x);
      let r, s;
      try {
        r = f(scale);
      } catch (e) {
        r = e.message;
      }
      try {
        s = g(scale);
      } catch (e) {
        s = e.message;
      }
      if (same(r, s)) agree++;
      else {
        differ++;
        console.log(`  differs: a=${a} b=${b} scale=${scale}: old ${JSON.stringify(s)} now ${JSON.stringify(r)}`);
      }
    }
console.log(`  ${agree} agree, ${differ} differ`);
