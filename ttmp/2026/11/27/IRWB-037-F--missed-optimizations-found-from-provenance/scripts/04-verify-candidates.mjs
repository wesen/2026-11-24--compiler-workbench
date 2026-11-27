// Verify candidate rules with the repository's verifier (verifyRule, the options of the recorded evidence:
// 1e6 random assignments, seed 7, exhaustive 2^32 where it applies) and print each verdict, strength and method.
// usage: node 04-verify-candidates.mjs [--random N] [--json out.json]
import { writeFileSync } from 'node:fs';
const root = new URL('../../../../../../', import.meta.url);
const { verifyRule } = await import(new URL('dist/typed/rules/verify.js', root));
const { ruleText } = await import(new URL('dist/typed/rules/form.js', root));
const { REASSOC_RULES } = await import(new URL('dist/typed/rules/reassoc.js', root));
const argv = process.argv.slice(2);
const random = argv.includes('--random') ? +argv[argv.indexOf('--random') + 1] : 1e6;
const out = {};
for (const r of REASSOC_RULES.rules) {
  const t = performance.now();
  const e = verifyRule(r, { random, seed: 7, exhaustive32: true });
  out[r.name] = e;
  console.log(`${r.name.padEnd(18)} ${e.verdict} ${e.strength ?? '-'} ${Math.round(performance.now() - t)} ms  ${ruleText(r)}`);
  for (const m of e.methods) console.log(`    ${m.method.padEnd(16)} ${m.verdict} ${m.detail ?? ''} ${m.cases ?? ''}`);
  if (e.counterexample) console.log('    counterexample', JSON.stringify(e.counterexample));
}
if (argv.includes('--json')) writeFileSync(argv[argv.indexOf('--json') + 1], JSON.stringify(out, null, 1) + '\n');
