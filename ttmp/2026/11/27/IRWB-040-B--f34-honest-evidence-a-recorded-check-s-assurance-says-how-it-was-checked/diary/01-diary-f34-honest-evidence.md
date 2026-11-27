---
Title: 'Diary: F34 honest evidence'
Ticket: IRWB-040-B
Status: active
Topics:
    - framework
    - contracts
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T17:29:38.768578741-05:00
WhatFor: "Recording the investigation, decisions and evidence of IRWB-040-B"
WhenToUse: "Resuming IRWB-040-B or reviewing how the assurance change was made"
---

## Step 1: read the defect, the probe and the test

- Defect (BACKLOG F34 / IRWB-039 probe 01): `invariantInternal` in `src/framework/contracts/analysis-manager.ts`
  stamps every recorded check `assurance: 'checked'`, sampled or exhaustive alike; the only reader of
  `evidence.method`, `assuranceOf` in `src/framework/contracts/differential.ts`, calls anything that is not
  `sampled` `checked-exact`, including missing evidence and a misspelled method.
- Test to make pass: `tests/framework/r3-defects.test.mjs`, `F34: sampled and exhaustive checks record different
  assurance; unknown evidence is never exact`. It requires (a) a 5-case sampled differential and a 256-case
  exhaustive check to record different `CheckEvidence.assurance`, (b) `assuranceOf(undefined)` and
  `assuranceOf({method: 'typo'})` to be `!== 'checked-exact'`.
- Callers found: `assuranceOf` is called only by `tests/framework/ext-e5.test.mjs` (expects `checked-sampled` for
  the differential's own evidence) and nowhere in `src`. `CheckEvidence.assurance` is compared only against
  `'declared'` (gate logic in `analysis-manager.ts`) and asserted equal to `'checked'` in
  `tests/framework/contracts.test.mjs` - for an invariant whose evidence `{delta, tolerance}` carries **no**
  `method` - and for an analysis record (`ext-e4.test.mjs`), a different field
  (`AnalysisRecord.assurance: 'checked' | 'transferred'`, untouched by this step). That pins the "unknown evidence"
  bucket to the existing value `'checked'`: it was checked, but the evidence does not say how, so no exactness claim.
- Runtime evidence with a `method` field exists only for the framework differential (`method: 'sampled'`); the
  typed rules' `structural`/`exhaustive-w8`/`random-32` names live in offline rule-verification records
  (`src/typed/rules/evidence.ts`) that never flow through `checkInvariant`. So `assuranceOf` only needs to
  recognise the framework's own `sampled` and the conventional `exhaustive` (used by the test, and by any checker
  that says it covered its domain); everything else stays `'checked'`.
- No baseline surface reads assurance: `02-baselines.mjs` hashes images, instruction counts, edit records and CUDA
  source/IR revisions; `src/typed/program.ts` reads `evidence.method === 'sampled'` directly (unchanged by this
  step, which never touches evidence).
