#!/usr/bin/env node
// IRWB-040-C (F34): what `assuranceOf` says about evidence, and what the manager records for a sampled and for an
// exhaustive check. Needs `npm run build` first. Run from anywhere:
//   node ttmp/2026/11/27/IRWB-040-C--.../scripts/01-assurance-mapping.mjs
// Exit code 1 when a claim below fails. R3's probe of the same defect (ttmp/2026/11/26/IRWB-019-.../various/
// r3-synthesis/scripts/01-assurance-of-sampled-and-exact.mjs) is the same experiment plus a grep of the callers.
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.env.ROOT ?? resolve(here, '../../../../../..'));
const dist = p => import(pathToFileURL(resolve(root, 'dist', p)).href);
const C = await dist('framework/contracts/index.js');
const { assuranceOf } = await dist('framework/contracts/assurance.js');

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} assuranceOf(${label}) = ${actual} (expected ${expected})`);
};

console.log('1. evidence shapes -> assurance');
check('undefined', assuranceOf(undefined), 'checked');
check('null', assuranceOf(null), 'checked');
check('{} (no method)', assuranceOf({}), 'checked');
check("{ method: 'typo' }", assuranceOf({ method: 'typo' }), 'checked');
check("{ method: 7 } (not a string)", assuranceOf({ method: 7 }), 'checked');
check("'sampled' (a string, not evidence)", assuranceOf('sampled'), 'checked');
check("{ method: 'sampled' }", assuranceOf({ method: 'sampled' }), 'checked-sampled');
check("{ method: 'exhaustive' }", assuranceOf({ method: 'exhaustive' }), 'checked-exact');
check("{ method: 'exhaustive-32' }", assuranceOf({ method: 'exhaustive-32' }), 'checked-exact');
check("{ method: 'proof' }", assuranceOf({ method: 'proof' }), 'checked-exact');
check("{ method: 'random-32' } (a domain's sample)", assuranceOf({ method: 'random-32' }), 'checked');

console.log('2. a sampled differential and an exhaustive invariant, through one AnalysisManager');
const Fn = C.defineIR({ id: 'probe.fn', version: '1', description: 'a unary function by name', validate() {} });
const table = { id: x => x, buggy: x => (x % 2 ? x : x | 1) }; // wrong on every even input
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
    for (let x = 0; x < 256; x++)
      if (table[baseline.value](x) !== table[subject.value](x)) return { ok: false, reason: `x=${x}` };
    return { ok: true, evidence: { method: 'exhaustive', domain: 'u8', cases: 256 } };
  },
});
const noEvidence = C.defineInvariant({
  id: 'probe.no-evidence', version: '1', description: 'a check that records nothing',
  inputs: { baseline: Fn, subject: Fn },
  check: () => ({ ok: true, evidence: { delta: 0, tolerance: 1 } }),
});
const m = new C.AnalysisManager();
const run = inv => m.checkInvariant(inv, { baseline: C.createArtifact(Fn, 'f', 'id'), subject: C.createArtifact(Fn, 'g', 'id') });
const [a, b, c] = [await run(sampled), await run(exhaustive), await run(noEvidence)];
for (const [label, e] of [['sampled', a], ['exhaustive', b], ['evidence without a method', c]])
  console.log(`   ${label}: ok ${e.ok} | assurance ${e.assurance} | evidence.method ${e.evidence?.method}`);
const claims = [
  ['a sample and an exhaustion record different assurance', a.assurance !== b.assurance],
  ['the sampled check is the weaker one', a.assurance === 'checked-sampled' && b.assurance === 'checked-exact'],
  ['unknown evidence is never exact', assuranceOf(undefined) !== 'checked-exact'],
];
for (const [label, ok] of claims) {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
}
console.log(failures ? `${failures} claim(s) failed` : 'all claims hold');
process.exit(failures ? 1 : 0);
