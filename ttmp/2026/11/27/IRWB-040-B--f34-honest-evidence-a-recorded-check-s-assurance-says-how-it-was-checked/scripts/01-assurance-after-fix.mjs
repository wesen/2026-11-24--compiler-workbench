// IRWB-040-B: what a recorded check's assurance says after the F34 fix. The R3 probe 01
// (ttmp/2026/11/26/IRWB-019-.../various/r3-synthesis/scripts/01-assurance-of-sampled-and-exact.mjs) showed a
// 5-case sample and a 256-case exhaustion both recording 'checked' and assuranceOf calling missing or
// misspelled evidence exact. After the fix: run both through one AnalysisManager and print what each records.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const imp = p => import(pathToFileURL(resolve(root, p)).href);
const at = p => resolve(root, p);
const dist = p => imp(`dist/${p}`);
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

// 5. the assurance also flows into a transformation contract's recorded checks.
const contract = C.defineTransformation({
  id: 'probe.tx', version: '1', description: 'ensures a sampled differential',
  inputs: { baseline: Fn, subject: Fn }, outputs: { subject: Fn },
  ensures: [{ invariant: sampled, bindings: { baseline: { from: 'inputs', port: 'baseline' }, subject: { from: 'inputs', port: 'subject' } } }],
  run: (_ctx, inputs) => ({ outputs: { subject: inputs.subject } }),
});
const t = await m.verifyTransformation({ baseline: C.createArtifact(Fn, 'f', 'id'), subject: C.createArtifact(Fn, 'f', 'buggy') }, { subject: C.createArtifact(Fn, 'f', 'buggy') }, contract);
console.log('5. checks recorded by a transformation contract:', t.execution.checks.map(c => `${c.phase}/${c.assurance}`).join(', '));
