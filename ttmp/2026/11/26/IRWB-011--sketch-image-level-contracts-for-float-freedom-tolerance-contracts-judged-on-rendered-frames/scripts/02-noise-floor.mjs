// IRWB-011: the Monte Carlo noise floor of Candela frames, from the passes scripts/01-render-passes.mjs saved.
//
//   node scripts/02-noise-floor.mjs [--dir various/01-passes] [--json various/02-noise-floor.json]
//
// For each scene with P passes (colour r, g, b per pixel):
//   exposure   k = 0.18 / exp(mean log luminance) of the mean of all P passes (viewImage's automatic exposure,
//              computed once, so every image of the scene is mapped the same way)
//   display    D(x) = round(255 * srgb(k x / (1 + k x))) per channel (viewImage's colour view)
//   pairs      A = mean of passes [0, n), B = mean of passes [n, 2n), for n = 1, 2, 4, ..., P/2: two independent
//              n-pass accumulations of the same estimator (the same program, different frame indices)
//              linear: RMS of A - B relative to the RMS of the all-pass mean; max |A - B| relative to the same
//              display: PSNR = 10 log10(255^2 / MSE) over channels; max |D(A) - D(B)| in 8-bit levels;
//                       the share of channel values whose 8-bit levels differ
//   per pixel  with all P passes: sample standard deviation s per channel; the share of pixels with s = 0
//   z test     at n = P/2: z = (A - B) / sqrt((sA^2 + sB^2) / n) per channel, sA, sB the halves' sample
//              variances; the share of |z| > 3 (0.27 % for a normal distribution) and the mean of z^2 (1 expected)
//   tail       the share of the total squared difference of the n = 1 pair carried by its largest 1 % of values
//   spread     per pixel, the luminance's sample standard deviation over all P passes divided by its mean (pixels
//              with a positive mean): the median and the 90th percentile, i.e. one pass's relative noise; an n-pass
//              mean's is this divided by sqrt(n)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const dir = flag('--dir', join(here, '../various/01-passes'));
const jsonOut = flag('--json', join(here, '../various/02-noise-floor.json'));

const srgb = x => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const fin = x => (Number.isFinite(x) ? x : 0);

export function load(dir, id) {
  const meta = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
  const buf = readFileSync(join(dir, `${id}.f32`));
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const n = meta.size[0] * meta.size[1];
  const pass = p => all.subarray(p * n * 4, (p + 1) * n * 4);
  return { meta, n, pass };
}

/** The mean of passes [a, b) as rgb per pixel (Float64Array, 3 per pixel). */
export function meanOf(sc, a, b) {
  const out = new Float64Array(sc.n * 3);
  for (let p = a; p < b; p++) {
    const c = sc.pass(p);
    for (let i = 0; i < sc.n; i++) for (let ch = 0; ch < 3; ch++) out[3 * i + ch] += fin(c[4 * i + ch]);
  }
  for (let i = 0; i < out.length; i++) out[i] /= b - a;
  return out;
}

export function exposureOf(rgb) {
  let sum = 0,
    m = 0;
  for (let i = 0; i < rgb.length; i += 3) {
    const l = 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2];
    if (l > 0) {
      sum += Math.log(l);
      m++;
    }
  }
  return m ? 0.18 / Math.exp(sum / m) : 1;
}
export const display = (k, x) => {
  const y = Math.max(0, x * k);
  return Math.round(255 * srgb(y / (1 + y)));
};

/** Linear and display distances between two rgb images of one scene. */
export function compare(a, b, k, ref) {
  let se = 0,
    sr = 0,
    max = 0,
    se8 = 0,
    max8 = 0,
    diff8 = 0;
  const sq = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    se += d * d;
    sq[i] = d * d;
    sr += ref[i] * ref[i];
    if (Math.abs(d) > max) max = Math.abs(d);
    const d8 = display(k, a[i]) - display(k, b[i]);
    se8 += d8 * d8;
    if (Math.abs(d8) > max8) max8 = Math.abs(d8);
    if (d8) diff8++;
  }
  const rmsRef = Math.sqrt(sr / a.length);
  const mse8 = se8 / a.length;
  const sorted = Array.from(sq).sort((x, y) => y - x);
  const top = sorted.slice(0, Math.max(1, Math.round(sorted.length / 100))).reduce((s, x) => s + x, 0);
  return {
    relRms: Math.sqrt(se / a.length) / rmsRef,
    relMax: max / rmsRef,
    psnr8: mse8 ? 10 * Math.log10((255 * 255) / mse8) : Infinity,
    max8,
    diff8Share: diff8 / a.length,
    top1PctShare: se ? top / se : 0,
  };
}

function varianceOf(sc, a, b, mean) {
  const v = new Float64Array(sc.n * 3);
  for (let p = a; p < b; p++) {
    const c = sc.pass(p);
    for (let i = 0; i < sc.n; i++)
      for (let ch = 0; ch < 3; ch++) {
        const d = fin(c[4 * i + ch]) - mean[3 * i + ch];
        v[3 * i + ch] += d * d;
      }
  }
  for (let i = 0; i < v.length; i++) v[i] /= b - a - 1;
  return v;
}

export function analyse(sc) {
  const P = sc.meta.passes;
  const full = meanOf(sc, 0, P);
  const k = exposureOf(full);
  const pairs = [];
  for (let n = 1; 2 * n <= P; n *= 2) pairs.push({ n, ...compare(meanOf(sc, 0, n), meanOf(sc, n, 2 * n), k, full) });
  // per-pixel spread over all passes
  const v = varianceOf(sc, 0, P, full);
  let still = 0;
  for (let i = 0; i < sc.n; i++) if (v[3 * i] === 0 && v[3 * i + 1] === 0 && v[3 * i + 2] === 0) still++;
  // z test between the halves
  const h = P / 2;
  const A = meanOf(sc, 0, h),
    B = meanOf(sc, h, P);
  const vA = varianceOf(sc, 0, h, A),
    vB = varianceOf(sc, h, P, B);
  let z3 = 0,
    zz = 0,
    m = 0;
  for (let i = 0; i < A.length; i++) {
    const se = Math.sqrt((vA[i] + vB[i]) / h);
    if (se === 0) continue;
    const z = (A[i] - B[i]) / se;
    zz += z * z;
    if (Math.abs(z) > 3) z3++;
    m++;
  }
  // relative spread of one pass's luminance, per pixel
  const rel = [];
  for (let i = 0; i < sc.n; i++) {
    let s1 = 0,
      s2 = 0;
    for (let p = 0; p < P; p++) {
      const c = sc.pass(p);
      const l = 0.2126 * fin(c[4 * i]) + 0.7152 * fin(c[4 * i + 1]) + 0.0722 * fin(c[4 * i + 2]);
      s1 += l;
      s2 += l * l;
    }
    const m1 = s1 / P,
      sd = Math.sqrt(Math.max(0, (s2 - P * m1 * m1) / (P - 1)));
    if (m1 > 0) rel.push(sd / m1);
  }
  rel.sort((a, b) => a - b);
  const q = f => (rel.length ? rel[Math.min(rel.length - 1, Math.floor(f * rel.length))] : NaN);
  return {
    scene: sc.meta.scene,
    relStd: { pixels: rel.length, median: q(0.5), p90: q(0.9) },
    title: sc.meta.title,
    spectral: sc.meta.spectral,
    stride: sc.meta.stride,
    size: sc.meta.size,
    passes: P,
    frames: sc.meta.frames,
    engine: sc.meta.engine,
    instructionsPerPass: Math.round(sc.meta.stepsPerPass.reduce((a, b) => a + b, 0) / P),
    exposure: k,
    stillPixels: still,
    pairs,
    z: { n: h, values: m, over3Share: z3 / m, meanZ2: zz / m },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ids = readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5));
  const order = ['B-01', 'R-01', 'L-03', 'G-01', 'V-02', 'S-02', 'V-04', 'X-03'];
  ids.sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);
  const out = ids.map(id => analyse(load(dir, id)));
  writeFileSync(jsonOut, JSON.stringify(out, null, 1));
  const f = (x, d = 1) => (x === Infinity ? 'inf' : x.toFixed(d));
  console.log('scene  px   P  still | n   PSNR8  max8  diff8%  relRMS  relMax  top1% | z>3%  <z2> | relStd med p90');
  for (const r of out) {
    for (const p of r.pairs)
      console.log(
        [
          r.scene.padEnd(5),
          String(r.size[0] * r.size[1]).padStart(4),
          String(r.passes).padStart(3),
          String(r.stillPixels).padStart(5),
          '|',
          String(p.n).padStart(3),
          f(p.psnr8).padStart(6),
          String(p.max8).padStart(5),
          f(100 * p.diff8Share).padStart(6),
          f(p.relRms, 3).padStart(7),
          f(p.relMax, 2).padStart(7),
          f(100 * p.top1PctShare).padStart(6),
          '|',
          p.n === 1 ? f(100 * r.z.over3Share, 2).padStart(5) : '',
          p.n === 1 ? f(r.z.meanZ2, 2).padStart(5) : '',
          p.n === 1 ? `| ${f(r.relStd.median, 2)} ${f(r.relStd.p90, 2)}` : '',
        ].join(' '),
      );
  }
}
