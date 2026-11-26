// IRWB-008, measurement 02: the recorded evidence strength of every simplify and fold rule (src/typed/rules/
// evidence.ts), weighted by how often each rule fires: on the corpus (all six pipelines, from measurement 01's JSON)
// and on Candela's O2 (IRWB-006's recorded run, various/04-rules-equivalence-candela.json). No program is compiled.
//
// usage: node 02-evidence-strength-by-firing.mjs <01-edit-census-corpus.json> <IRWB-006 04-rules-equivalence-candela.json>
const root = new URL('../../../../../../', import.meta.url).pathname;
const { readFileSync } = await import('node:fs');
const { SIMPLIFY_RULES } = await import(root + 'dist/typed/rules/simplify.js');
const { FOLD_RULES } = await import(root + 'dist/typed/rules/fold.js');
const { RULE_EVIDENCE, EVIDENCE_OPTIONS } = await import(root + 'dist/typed/rules/evidence.js');
const { ruleFingerprint } = await import(root + 'dist/typed/rules/verify.js');

const [censusPath, candelaPath] = process.argv.slice(2);
const census = JSON.parse(readFileSync(censusPath, 'utf8'));
const candela = JSON.parse(readFileSync(candelaPath, 'utf8')).firings;
const corpus = { simplify: census.byPass.simplify.firings, fold: census.byPass.fold.firings };

const lines = [`evidence options: ${JSON.stringify(EVIDENCE_OPTIONS)}`];
for (const set of [SIMPLIFY_RULES, FOLD_RULES]) {
  const byStrength = {};
  let stale = 0;
  for (const r of set.rules) {
    const e = RULE_EVIDENCE[r.name];
    if (!e || e.fingerprint !== ruleFingerprint(r)) stale++;
    const s = (byStrength[e?.strength ?? 'none'] ??= { rules: 0, corpus: 0, candela: 0, fired: [] });
    s.rules++;
    const fc = corpus[set.name][r.name] ?? 0,
      fk = candela[set.name][r.name] ?? 0;
    s.corpus += fc;
    s.candela += fk;
    if (fc || fk) s.fired.push(`${r.name} ${fc}/${fk}`);
  }
  lines.push(`${set.name}: ${set.rules.length} rules, ${stale} without matching evidence`);
  lines.push('  strength                 rules  firings corpus  firings Candela');
  for (const [s, v] of Object.entries(byStrength))
    lines.push(`  ${s.padEnd(24)} ${String(v.rules).padStart(5)} ${String(v.corpus).padStart(15)} ${String(v.candela).padStart(16)}`);
  for (const [s, v] of Object.entries(byStrength)) if (v.fired.length) lines.push(`  ${s}: ${v.fired.join(', ')}`);
}
console.log(lines.join('\n'));
