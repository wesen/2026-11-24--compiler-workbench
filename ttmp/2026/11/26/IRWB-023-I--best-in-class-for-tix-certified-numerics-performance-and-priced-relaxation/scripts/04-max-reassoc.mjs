// E8: the max/min reassociation claim. The meaning folds max from -Infinity with
// Math.max semantics (NaN propagates, max(-0,+0) = +0; min picks -0). If that
// operation is associative and commutative, ANY evaluation tree over the same
// operand multiset yields the same result, and a checked pass may parallelize
// max reductions freely (exact class). Test by brute force over random f32
// multisets: sequential fold vs 10^4 random binary trees, including NaN, +-0,
// +-Infinity. Same probe on sum, where the claim must FAIL.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fr = Math.fround;
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(20261126);
function specialWord() {
  const r = random();
  if (r < 0.2) return NaN;
  if (r < 0.3) return -0;
  if (r < 0.4) return 0;
  if (r < 0.45) return Infinity;
  if (r < 0.5) return -Infinity;
  return fr((2 * random() - 1) * (random() < 0.5 ? 1 : 1e30));
}
// the operation as the interpreter and the CUDA emitter define it
function opMax(a, b) {
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  if (a === b) {
    const x = new Uint32Array(new Float32Array([a]).buffer)[0];
    const y = new Uint32Array(new Float32Array([b]).buffer)[0];
    return new Float32Array(new Uint32Array([x & y]).buffer)[0];
  }
  return a > b ? a : b;
}
function opMin(a, b) {
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  if (a === b) {
    const x = new Uint32Array(new Float32Array([a]).buffer)[0];
    const y = new Uint32Array(new Float32Array([b]).buffer)[0];
    return new Float32Array(new Uint32Array([x | y]).buffer)[0];
  }
  return a < b ? a : b;
}
const opSum = (a, b) => fr(a + b);
function fold(op, xs) { let acc = op === opSum ? 0 : op === opMax ? -Infinity : Infinity; for (const x of xs) acc = op(acc, x); return acc; }
function randomTree(op, xs, lo, hi) {
  if (hi - lo === 1) return xs[lo];
  const mid = lo + 1 + Math.floor(random() * (hi - lo - 1));
  return op(randomTree(op, xs, lo, mid), randomTree(op, xs, mid, hi));
}
const results = {};
for (const [name, op] of [['max', opMax], ['min', opMin], ['sum', opSum]]) {
  let mismatches = 0, trials = 0;
  for (let t = 0; t < 2000; t++) {
    const n = 2 + Math.floor(random() * 60);
    const xs = Array.from({ length: n }, specialWord);
    if (op === opSum && xs.some(Number.isNaN)) continue;
    const base = fold(op, xs);
    const words = (v) => new Uint32Array(new Float32Array([v]).buffer)[0];
    const baseW = words(base);
    for (let k = 0; k < 50; k++) {
      const w = words(randomTree(op, xs, 0, n));
      trials++;
      if (w !== baseW) mismatches++;
    }
  }
  results[name] = { trials, mismatches };
  console.log(`${name}: ${mismatches} word mismatches in ${trials} tree evaluations`);
}
writeFileSync(join(here, '..', 'results', 'max-reassoc.json'), JSON.stringify(results, null, 2));
console.log('E8 done');
