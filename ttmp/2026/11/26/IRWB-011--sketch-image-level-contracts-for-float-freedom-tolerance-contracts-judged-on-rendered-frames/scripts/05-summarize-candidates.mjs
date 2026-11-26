// IRWB-011: one line per scene and variant from scripts/03-float-candidates.mjs's JSONL output.
//   node scripts/05-summarize-candidates.mjs various/03-float-candidates.jsonl [various/03-float-candidates-X03.jsonl]
// With the noise floor of scripts/02-noise-floor.mjs (various/02-noise-floor.json), it also prints the guide's
// section 14 budget at f = 0.1 for pass 0 and for the N-pass means:
//   budget(n) = PSNR_noise(n) + 20 log10(1/f) + 3.01 dB   (PSNR_noise(n): n-pass mean against an independent one)
// and the margin of the paired PSNR above it (positive: within budget).
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const floor = JSON.parse(readFileSync(join(here, '../various/02-noise-floor.json'), 'utf8'));
const F = 0.1;
const budget = (scene, n) => {
  const p = floor.find(s => s.scene === scene)?.pairs.find(q => q.n === n);
  return p ? p.psnr8 + 20 * Math.log10(1 / F) + 10 * Math.log10(2) : null;
};
const margin = (psnr, b) => (b == null ? 'n/a' : psnr === Infinity || psnr == null ? 'inf' : (psnr - b).toFixed(1));
const f = (x, d = 1) => (x == null ? 'inf' : x.toFixed(d));
for (const file of process.argv.slice(2)) {
  if (!existsSync(file)) continue;
  const rows = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  for (const r of rows) {
    console.log(`${r.scene} harness ${r.harnessDifferentFloats} exact/px ${r.exactPerPixel} noise PSNR ${f(r.noise.psnr8)} max ${r.noise.max8}`);
    for (const [k, v] of Object.entries(r.variants)) {
      const saved = v.savedPerPixel != null ? ` saved/px ${v.savedPerPixel.toFixed(1)} (${((100 * v.savedPerPixel) / r.exactPerPixel).toFixed(2)}%)` : '';
      const z = v.z
        ? ` | z exact ${(100 * v.z.exactVsExact.over3Share).toFixed(2)}% ${v.z.exactVsExact.meanZ2.toFixed(3)}` +
          ` variant ${(100 * v.z.variantVsExact.over3Share).toFixed(2)}% ${v.z.variantVsExact.meanZ2.toFixed(3)}` +
          ` | ${v.z.n}-pass means paired PSNR ${f(v.meanVsExactMean.psnr8)} max ${v.meanVsExactMean.max8}` +
          ` levels-differ ${(100 * v.meanVsExactMean.diff8Share).toFixed(2)}%` +
          ` | budget f=0.1: pass 0 ${f(budget(r.scene, 1))} margin ${margin(v.vsExact.psnr8, budget(r.scene, 1))},` +
          ` ${v.z.n} passes ${f(budget(r.scene, v.z.n))} margin ${margin(v.meanVsExactMean.psnr8, budget(r.scene, v.z.n))}`
        : '';
      // linear RMS of the paired difference against the linear RMS of one pass against another, both relative to the
      // RMS of the scene's all-pass mean: how far below the noise the change is, in dB (inf when nothing differs)
      const below = v.vsExact.relRms > 0 ? 20 * Math.log10(r.noise.relRms / v.vsExact.relRms) : null;
      console.log(
        `  ${k.padEnd(8)} floats ${v.differentFloats} pixels ${v.differentPixels} paired PSNR ${f(v.vsExact.psnr8)} max ${v.vsExact.max8} linear dB below noise ${f(below)}` +
          ` levels-differ ${(100 * v.vsExact.diff8Share).toFixed(2)}% relRMS ${v.vsExact.relRms.toExponential(2)} per px ${v.perPixel}${saved}${z}`,
      );
    }
  }
}
