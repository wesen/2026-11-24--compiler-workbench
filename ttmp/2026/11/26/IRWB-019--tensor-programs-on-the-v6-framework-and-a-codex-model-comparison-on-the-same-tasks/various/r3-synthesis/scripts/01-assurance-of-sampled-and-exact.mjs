// Claim (C): a sampled differential check is recorded with the same assurance as an exact one, and `assuranceOf`
// is never called. (B, A: `assuranceOf` maps missing or unknown evidence to 'checked-exact'.)
// Method: run two invariants through one AnalysisManager. (1) a sampled differential whose generator only draws odd
// inputs, against a subject wrong on every even input; (2) an exhaustive check over all 256 values of a byte domain
// against the correct subject. Print the recorded `assurance` of both. Then grep callers of `assuranceOf`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { dist, at, root } from './00-root.mjs';
const C = await dist('framework/contracts/index.js');
const { assuranceOf } = await dist('framework/contracts/differential.js');

const Fn = C.defineIR({ id: 'probe.fn', version: '1', description: 'a unary function by name', validate() {} });
const table = { id: x => x, buggy: x => (x % 2 ? x : x | 1) };
const sampled = C.differential({
  id: 'probe.sampled', version: '1', description: 'same results on sampled inputs',
  inputs: { baseline: Fn, subject: Fn }, baseline: 'baseline', subject: 'subject',
  count: 5, seed: 1, cases: () => [1, 3, 5, 7, 9],
  run: (_side, art, x) => table[art.value](x), compare: (a, b) => a === b,
});
const exhaustive = C.defineInvariant({
  id: 'probe.exhaustive', version: '1', description: 'same results on every byte',
  inputs: { baseline: Fn, subject: Fn },
  check: (_ctx, { baseline, subject }) => {
    for (let x = 0; x < 256; x++) if (table[baseline.value](x) !== table[subject.value](x)) return { ok: false, reason: `x=${x}` };
    return { ok: true, evidence: { method: 'exhaustive', domain: 'u8', cases: 256 } };
  },
});
const m = new C.AnalysisManager();
const a = await m.checkInvariant(sampled, { baseline: C.createArtifact(Fn, 'f', 'id'), subject: C.createArtifact(Fn, 'f', 'buggy') });
const b = await m.checkInvariant(exhaustive, { baseline: C.createArtifact(Fn, 'f', 'id'), subject: C.createArtifact(Fn, 'g', 'id') });
console.log('1. sampled, subject wrong on every even input: ok', a.ok, '| assurance', a.assurance, '| evidence.method', a.evidence?.method);
console.log('2. exhaustive over u8, subject correct:        ok', b.ok, '| assurance', b.assurance, '| evidence.method', b.evidence?.method);
console.log('   same assurance recorded for both:', a.assurance === b.assurance);
console.log('3. assuranceOf(sampled evidence)', assuranceOf(a.evidence), '| assuranceOf(undefined)', assuranceOf(undefined),
  "| assuranceOf({method:'typo'})", assuranceOf({ method: 'typo' }), "| assuranceOf({method:'exhaustive'})", assuranceOf(b.evidence));

const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|mjs)$/.test(p) ? [p] : []; });
const hits = [];
for (const dir of ['src', 'tests', 'tools'])
  for (const f of walk(at(dir))) readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (/assuranceOf\b/.test(l)) hits.push(`${relative(root, f)}:${i + 1}: ${l.trim()}`); });
console.log('4. every mention of assuranceOf in src/, tests/, tools/:');
for (const h of hits) console.log('   ' + h);
