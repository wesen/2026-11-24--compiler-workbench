// Verify the two new simplify rules (shl-shru-mask, sub-shl-shru-mask) with the evidence options
// (random 1e6, seed 7, exhaustive32 requested) and write their records into src/typed/rules/evidence.ts,
// keeping the existing records. The rules test fails a rule whose record is missing or stale.
// usage: node 11-verify-new-rules.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../../../../../../', import.meta.url).pathname;
const { verifyRule } = await import(root + 'dist/typed/rules/verify.js');
const { SIMPLIFY_RULES } = await import(root + 'dist/typed/rules/simplify.js');
const { EVIDENCE_OPTIONS } = await import(root + 'dist/typed/rules/evidence.js');

const fresh = {};
for (const r of SIMPLIFY_RULES.rules.filter(r => r.name.includes('mask'))) {
  const e = verifyRule(r, EVIDENCE_OPTIONS);
  console.log(r.name, e.verdict, e.strength, e.methods.map(m => `${m.method}:${m.verdict}`).join(' '));
  if (e.verdict !== 'sound') throw new Error(`${r.name} did not verify`);
  fresh[r.name] = e;
}
const path = root + 'src/typed/rules/evidence.ts';
const text = readFileSync(path, 'utf8');
for (const [name] of Object.entries(fresh))
  if (text.includes(`'${name}':`)) throw new Error(`${name} already has a record`);
const insert = Object.entries(fresh)
  .map(([name, e]) => `  '${name}': ${JSON.stringify(e, null, 2).replace(/\n/g, '\n  ')},`)
  .join('\n');
const at = text.lastIndexOf('\n};\n');
if (at < 0) throw new Error('evidence.ts: no end of RULE_EVIDENCE');
writeFileSync(path, text.slice(0, at) + '\n' + insert + text.slice(at));
console.log('records added:', Object.keys(fresh).join(', '));
