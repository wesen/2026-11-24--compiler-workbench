import assert from 'node:assert/strict';
import { compileTix, runTix } from '../../../../../../dist/tensor/index.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/differential.js';

const f = Math.fround;
const bits = new DataView(new ArrayBuffer(4));
const word = x => { bits.setFloat32(0, x); return bits.getUint32(0); };
const units = 2 ** 24;
const random = seededRandom(8317);
const integer = (min, max) => min + Math.floor(random() * (max - min + 1));

function dyadic(x) {
  const w = word(x);
  const exponent = (w >>> 23) & 255;
  let coefficient = w & 0x7fffff;
  if (exponent === 255) throw Error('outside finite f32');
  if (exponent) coefficient += 2 ** 23;
  if (!coefficient) return [0, 0];
  let scale = exponent ? exponent - 150 : -149;
  while (!(coefficient & 1)) {
    coefficient >>>= 1;
    scale++;
  }
  return [w >>> 31 ? -coefficient : coefficient, scale];
}

function grid(xs) {
  const terms = Array.from(xs, dyadic);
  const scale = terms.reduce((minimum, [q, e]) => q ? Math.min(minimum, e) : minimum, Infinity);
  const e = Number.isFinite(scale) ? scale : 0;
  const coeffs = terms.map(([q, scale]) => q ? q * (2 ** (scale - e)) : 0);
  if (coeffs.some(q => q < -128 || q > 127)) return undefined;
  return { e, coeffs };
}

function ordered(a, b) {
  let sum = 0;
  for (let j = 0; j < a.length; j++) sum = f(sum + f(a[j] * b[j]));
  return sum;
}

function guarded(a, b) {
  const x = grid(a), y = grid(b);
  if (!x || !y) return { reason: 'grid' };
  const magnitude = x.coeffs.reduce((n, q, j) => n + Math.abs(q * y.coeffs[j]), 0);
  const e = x.e + y.e;
  if (magnitude > units) return { reason: 'integer bound' };
  if (magnitude === 0) return { result: 0 };
  if (e < -149 || e + Math.floor(Math.log2(magnitude)) > 127) return { reason: 'exponent bound' };
  let result = 0;
  for (let j = a.length - 1; j >= 0; j--) result += x.coeffs[j] * y.coeffs[j];
  return { result: result * (2 ** e) };
}

const p = compileTix('fn dot(a: f32[M,K], b: f32[K,N]): f32[M,N] { y[i,j] = sum(k) a[i,k]*b[k,j]; return y; }');
function tix(a, b) {
  return runTix(p, 'dot', { a: { shape: [1, a.length], data: a },
    b: { shape: [b.length, 1], data: b } }).data[0];
}

const hits = {};
for (const profile of ['fixed-grid', 'varied-grids', 'f32-bounded', 'raw-near-bounds']) {
  const verdicts = { accepted: 0, grid: 0, 'integer bound': 0, 'exponent bound': 0 };
  for (let i = 0; i < 1200; i++) {
    const k = integer(3, 1024);
    const eA = profile === 'fixed-grid' ? -7 : integer(-75, 55);
    const eB = profile === 'fixed-grid' ? -7 : integer(-75, 55);
    const sample = e => Float32Array.from({ length: k }, () => {
      if (profile === 'f32-bounded') return 0.2 * random() - 0.1;
      if (profile === 'raw-near-bounds') return integer(-128, 127) * (2 ** (e + integer(0, 9)));
      return integer(-128, 127) * (2 ** e);
    });
    const a = sample(eA), b = sample(eB);
    if (i % 2 === 0) a[0] = -0;
    const check = guarded(a, b);
    if (check.reason) verdicts[check.reason]++;
    else {
      verdicts.accepted++;
      assert.equal(word(check.result), word(ordered(a, b)));
    }
    if (i < 8) assert.equal(word(tix(a, b)), word(ordered(a, b)));
  }
  hits[profile] = verdicts;
}
console.log(JSON.stringify({ test: 'dot-domains', counts: hits, interpreterChecks: 32 }));

// A contraction with per-row A and per-column B grids, but neither tensor fits one global grid.
const rowExponents = [-11, -8, -5, -2], colExponents = [-12, -9, -6, -3], k = 128;
const aRows = rowExponents.map(e => Float32Array.from({ length: k }, () => integer(-128, 127) * 2 ** e));
const bCols = colExponents.map(e => Float32Array.from({ length: k }, () => integer(-128, 127) * 2 ** e));
const a = Float32Array.from(aRows.flatMap(row => [...row]));
const b = Float32Array.from({ length: k * bCols.length }, (_, i) => bCols[i % bCols.length][Math.floor(i / bCols.length)]);
const actual = runTix(p, 'dot', { a: { shape: [aRows.length, k], data: a },
  b: { shape: [k, bCols.length], data: b } }).data;
assert.equal(Boolean(grid(a) || grid(b)), false);
let pairMatches = 0;
for (const [i, row] of aRows.entries()) for (const [j, col] of bCols.entries()) {
  const check = guarded(row, col);
  assert.equal(check.reason, undefined);
  assert.equal(word(check.result), word(actual[i * bCols.length + j]));
  pairMatches++;
}
console.log(JSON.stringify({ test: 'per-axis-grids', globalA: false, globalB: false, pairMatches }));

const cases = [
  { label: 'binary32 coefficient limit', a: new Float32Array(1042).fill(127), b: new Float32Array(1042).fill(127) },
  { label: 'underflow before addition', a: Float32Array.of(2 ** -75, 2 ** -75), b: Float32Array.of(2 ** -75, 2 ** -75) },
  { label: 'exact subnormal grid', a: Float32Array.of(2 ** -75, 2 ** -75), b: Float32Array.of(2 ** -74, 2 ** -74) },
  { label: 'overflow before cancellation', a: Float32Array.of(2 ** 65, -(2 ** 65)), b: Float32Array.of(2 ** 65, 2 ** 65) },
  { label: 'signed zero', a: Float32Array.of(-0, 0, -0), b: Float32Array.of(1, -1, -1) },
];
for (const { label, a, b } of cases) {
  const check = guarded(a, b);
  const exactProducts = a.reduce((n, x, i) => n + x * b[i], 0);
  const source = tix(a, b);
  const onceRounded = f(exactProducts);
  if (!check.reason) assert.equal(word(check.result), word(source));
  else assert.notEqual(word(onceRounded), word(source));
  console.log(JSON.stringify({ test: 'boundary', label, proof: check.reason ?? 'accepted',
    ordered: String(source), onceRounded: String(onceRounded),
    orderedWord: word(source).toString(16), onceRoundedWord: word(onceRounded).toString(16) }));
}
