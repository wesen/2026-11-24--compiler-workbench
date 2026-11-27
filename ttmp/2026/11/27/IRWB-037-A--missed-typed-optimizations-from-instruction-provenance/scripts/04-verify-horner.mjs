// Generate the new rule's evidence without rerunning the exhaustive checks for frozen older rules.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../../../../../../', import.meta.url);
const { verifyRule } = await import(new URL('dist/typed/rules/verify.js', root));
const { EVIDENCE_OPTIONS } = await import(new URL('dist/typed/rules/evidence.js', root));
const { SIMPLIFY_RULES } = await import(new URL('dist/typed/rules/simplify.js', root));
const rule = SIMPLIFY_RULES.rules.find(r => r.name === 'horner31-mask15');
const result = verifyRule(rule, EVIDENCE_OPTIONS);
assert.equal(result.verdict, 'sound');
assert.equal(result.strength, 'proof');
console.log(JSON.stringify({ options: EVIDENCE_OPTIONS, evidence: result }, null, 2));

if (process.argv.includes('--record')) {
  const dest = new URL('src/typed/rules/evidence.ts', root);
  const old = readFileSync(dest, 'utf8');
  const marker = 'export const RULE_EVIDENCE: Readonly<Record<string, RuleEvidence>> = {\n';
  assert.ok(old.includes(marker));
  const text = JSON.stringify(result, null, 2).split('\n').map(line => '  ' + line).join('\n').trimEnd();
  const entry = `  // IRWB-037-A scripts/04-verify-horner.mjs\n  '${result.rule}': ${text.trimStart()},\n`;
  const previous = /  \/\/ IRWB-037-A scripts\/04-verify-horner\.mjs\n[\s\S]*?\n  },\n/;
  writeFileSync(dest, previous.test(old) ? old.replace(previous, entry) : old.replace(marker, marker + entry));
}
