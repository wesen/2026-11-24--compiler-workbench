// IRWB-007: the tables of measurement 3, from the JSON that 03-binding-time-profile.mjs wrote (no Candela runs here).
//   node …/04-profile-summary.mjs various/03-binding-time-profile-all.json > various/04-profile-summary.txt
import { readFileSync } from 'node:fs';
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const pad = (x, n) => String(x).padStart(n);
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : '-');
const r2 = (lo, hi) => `${lo.toFixed(2)}-${hi.toFixed(2)}`;
const out = [];
out.push('Measurement 3: binding-time profile of cdlRenderSpan at r0, per pixel (stride 8), three specializer models');
out.push('ops: evaluator operations per pixel (value nodes except const/get/result/tuple/aaddr, plus stores and branches)');
out.push('bound = operations remaining after today\'s per-scene kernel / operations remaining after ideal specialization');
out.push('  (lo: every C operation counted as already folded today; hi: none of them); dce: residual = live X/D of the slice');
out.push('');
out.push('scene  px  ops/px  stmts/px  diff | M%   data(dce)   gen(dce)   control | oRow% | sections ops% static%');
const agg = { ops: 0, n: 0 };
for (const r of rows) {
  const d = r.data, g = r.gen, c = r.control;
  const total = d.totalPerPixel;
  const oRow = d.topFunctions.find(f => f.fn === 'oRow');
  const oRowOps = oRow ? oRow.C + oRow.K + oRow.M + oRow.X + oRow.D : 0;
  const sec = d.sections ? sum(d.sections) : NaN;
  const secStatic = d.sections ? d.sections.C + d.sections.K + d.sections.M : NaN;
  out.push(
    `${r.scene.padEnd(5)} ${pad(r.pixels, 4)} ${pad(total.toFixed(0), 7)} ${pad(r.evaluatorStatementsPerPixel.toFixed(0), 8)} ${pad(r.differingFloats, 4)} |` +
      ` ${pad(d.bounds.memoryShare.toFixed(1), 4)} ${pad(r2(d.bounds.noTrickWithDce.lo, d.bounds.noTrickWithDce.hi), 11)} ${pad(r2(g.bounds.noTrickWithDce.lo, g.bounds.noTrickWithDce.hi), 10)}` +
      ` ${pad(r2(c.bounds.noTrick.lo, c.bounds.noTrick.hi), 9)} | ${pad(pct(oRowOps, total), 5)} | ${pad(pct(sec, total), 12)} ${pad(pct(secStatic, sec), 7)}`,
  );
}
const geo = k => Math.exp(rows.reduce((a, r) => a + Math.log(k(r)), 0) / rows.length);
out.push('');
out.push(`geometric means over ${rows.length} scenes: data(dce) lo ${geo(r => r.data.bounds.noTrickWithDce.lo).toFixed(2)} hi ${geo(r => r.data.bounds.noTrickWithDce.hi).toFixed(2)};` +
  ` gen(dce) lo ${geo(r => r.gen.bounds.noTrickWithDce.lo).toFixed(2)} hi ${geo(r => r.gen.bounds.noTrickWithDce.hi).toFixed(2)};` +
  ` control lo ${geo(r => r.control.bounds.noTrick.lo).toFixed(2)} hi ${geo(r => r.control.bounds.noTrick.hi).toFixed(2)}`);
const mins = k => Math.min(...rows.map(k)), maxs = k => Math.max(...rows.map(k));
out.push(`ranges: data(dce) lo ${mins(r => r.data.bounds.noTrickWithDce.lo).toFixed(2)}-${maxs(r => r.data.bounds.noTrickWithDce.lo).toFixed(2)};` +
  ` gen(dce) lo ${mins(r => r.gen.bounds.noTrickWithDce.lo).toFixed(2)}-${maxs(r => r.gen.bounds.noTrickWithDce.lo).toFixed(2)};` +
  ` control lo ${mins(r => r.control.bounds.noTrick.lo).toFixed(2)}-${maxs(r => r.control.bounds.noTrick.lo).toFixed(2)}`);
out.push(`differing output floats in all scenes and modes: ${rows.reduce((a, r) => a + r.differingFloats, 0)}`);
out.push('');
out.push('Per scene, data mode, by tag (operations per pixel), loads from constant memory by region, calls by their largest argument tag:');
for (const r of rows) {
  const d = r.data;
  const loads = Object.entries(d.loadsPerPixel).filter(([k]) => !['frame', 'other'].includes(k)).map(([k, v]) => `${k} ${(v.M + v.X).toFixed(1)}`).join(', ');
  out.push(`${r.scene.padEnd(5)} C ${d.perPixel.C} K ${d.perPixel.K} M ${d.perPixel.M} X ${d.perPixel.X} D ${d.perPixel.D} live ${d.slice.liveXDPerPixel} | loads M+X: ${loads} | calls C ${d.callsByMaxArgTagPerPixel.C} M ${d.callsByMaxArgTagPerPixel.M} D ${d.callsByMaxArgTagPerPixel.D + d.callsByMaxArgTagPerPixel.X} | identity candidates ${d.identityCandidatesPerPixel}`);
}
out.push('');
out.push('Hand-staged scene sections (s<k>_...) against the fixed kernel, data mode, operations per pixel (C K M X D) and live X/D:');
for (const r of rows) {
  const d = r.data;
  if (!d.sections) continue;
  const f = o => `C ${o.C} K ${o.K} M ${o.M} X ${o.X} D ${o.D}`;
  out.push(`${r.scene.padEnd(5)} sections ${f(d.sections)} live ${d.sectionsSlice.liveXD} | kernel ${f(d.kernel)} live ${d.kernelSlice.liveXD}`);
}
console.log(out.join('\n'));
