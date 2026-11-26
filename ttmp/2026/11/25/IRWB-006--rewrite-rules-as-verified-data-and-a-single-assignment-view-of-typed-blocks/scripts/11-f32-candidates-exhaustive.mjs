// IRWB-006 B2: time the exhaustive 2^32 check of the two sound f32 candidate rules in a fresh process, after
// compileSide called the f32 operators directly (no opW array per call). Run from the repository root:
//   node ttmp/2026/11/25/IRWB-006--*/scripts/11-f32-candidates-exhaustive.mjs
const root = process.cwd() + '/';
const { verifyRule } = await import(root + 'dist/typed/rules/verify.js');
const C = await import(root + 'dist/typed/rules/candidates.js');
for (const r of C.F32_SOUND_CANDIDATES.rules) {
  const t = performance.now();
  const e = verifyRule(r, { random: 1e6, seed: 7, exhaustive32: true });
  console.log(r.name, e.verdict, e.strength, Math.round(performance.now() - t), 'ms', e.methods.map(m => m.method + ':' + m.verdict).join(','));
}
