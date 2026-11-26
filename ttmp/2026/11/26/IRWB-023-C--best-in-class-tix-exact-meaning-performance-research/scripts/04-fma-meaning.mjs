// IRWB-023-C experiment 04: can the Tix interpreter specify a fused multiply-add exactly?
//
// A Tix `fma` meaning would be RN32(a*b + c) with one rounding. JavaScript has no fma. Two candidate
// interpreter implementations are compared with the GB10's __fmaf_rn on the same triples:
//   naive: Math.fround(a * b + c). a*b is exact in f64 for f32 inputs, but a*b + c rounds to f64 first,
//          and that double rounding can land on an f32 midpoint.
//   eft:   s + e = a*b + c exactly (TwoSum); round s to f32 and break a tie at an f32 midpoint by the
//          sign of e.
// Families: uniformly random 32-bit words (including NaN, inf and subnormal), random normal values with
// random exponents, and constructed triples whose exact result sits just off an f32 midpoint.
// Usage (worktree root): node <ticket>/scripts/04-fma-meaning.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '04-fma-meaning');
const f = new Float32Array(1), w = new Uint32Array(f.buffer);
const fromBits = bits => ((w[0] = bits >>> 0), f[0]);
const bitsOf = x => ((f[0] = x), w[0]);
function next32(x, up) {
  if (x === 0) return fromBits(up ? 1 : 0x80000001);
  const b = bitsOf(x);
  return fromBits((x > 0) === up ? b + 1 : b - 1);
}
const MAX = fromBits(0x7f7fffff), OVERFLOW_MID = 2 ** 128 - 2 ** 103;

export function fma32(a, b, c) {
  const p = a * b; // exact for finite f32 operands: at most 48 significant bits, exponent within f64 range
  const s = p + c;
  if (!Number.isFinite(s)) return Math.fround(s);
  const bb = s - p;
  const e = p - (s - bb) + (c - bb); // s + e == p + c exactly
  const r = Math.fround(s);
  if (e === 0 || r === s) return r;
  if (!Number.isFinite(r)) return Math.abs(s) === OVERFLOW_MID && Math.sign(e) !== Math.sign(s) ? Math.sign(s) * MAX : r;
  const o = next32(r, s > r);
  if (s !== (r + o) / 2) return r; // not a midpoint: e cannot move s across one
  return e > 0 ? Math.max(r, o) : Math.min(r, o);
}
const naive = (a, b, c) => Math.fround(a * b + c);

let state = 0x9e3779b9;
const rand32 = () => {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
};
const families = { randomWords: [], randomNormals: [], nearMidpoint: [] };
for (let i = 0; i < 1 << 20; i++) families.randomWords.push([fromBits(rand32()), fromBits(rand32()), fromBits(rand32())]);
const normal = () => {
  const e = (rand32() % 120) - 60;
  return Math.fround(((rand32() / 2 ** 32) * 2 - 1) * 2 ** e);
};
for (let i = 0; i < 1 << 18; i++) families.randomNormals.push([normal(), normal(), normal()]);
for (let i = 0; i < 1 << 16; i++) {
  const ec = (rand32() % 200) - 100,
    sign = rand32() & 1 ? -1 : 1,
    below = rand32() & 1;
  const c = sign * fromBits(((ec + 127) << 23) | (rand32() & 0x7fffff) | 1); // odd significand
  const h = 2 ** (ec - 24); // half an f32 ulp of c
  const a = Math.fround(sign * (below ? -1 : 1) * h * (1 + 2 ** -23));
  const b = fromBits(0x3f7ffffe); // 1 - 2^-23, so a*b = +-h(1 - 2^-46)
  families.nearMidpoint.push([a, b, c]);
}

const all = Object.values(families).flat();
const bytes = Buffer.alloc(8 + 12 * all.length);
bytes.writeBigUInt64LE(BigInt(all.length), 0);
all.forEach(([a, b, c], i) => {
  bytes.writeFloatLE(a, 8 + 12 * i);
  bytes.writeFloatLE(b, 12 + 12 * i);
  bytes.writeFloatLE(c, 16 + 12 * i);
});
writeFileSync(join(dir, 'triples.bin'), bytes);
const root = process.cwd();
const run = JSON.parse(
  execFileSync(process.execPath, [join(root, 'tools/cuda-remote.mjs'), dir, '--runtime-input', 'triples.bin'], {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  }),
);
if (run.exit !== 0) throw Error(run.stderr);
const gpu = readFileSync(join(dir, 'out/fma.bin'));
rmSync(join(dir, 'triples.bin'));
rmSync(join(dir, 'out'), { recursive: true, force: true });

const same = (x, y) => (Number.isNaN(x) && Number.isNaN(y)) || bitsOf(x) === bitsOf(y);
let offset = 0;
const report = {};
for (const [name, triples] of Object.entries(families)) {
  let eft = 0,
    nv = 0,
    firstNaive;
  for (const [a, b, c] of triples) {
    const g = gpu.readFloatLE(4 * offset++);
    if (!same(fma32(a, b, c), g)) eft++;
    if (!same(naive(a, b, c), g)) {
      nv++;
      firstNaive ??= { a, b, c, gpu: g, naive: naive(a, b, c) };
    }
  }
  report[name] = { triples: triples.length, eftMismatches: eft, naiveMismatches: nv, firstNaive };
}
console.log(JSON.stringify(report, null, 1));
