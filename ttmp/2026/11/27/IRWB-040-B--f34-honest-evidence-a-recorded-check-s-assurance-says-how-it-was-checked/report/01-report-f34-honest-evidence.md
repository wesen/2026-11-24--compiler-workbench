---
Title: 'Report: F34 honest evidence'
Ticket: IRWB-040-B
Status: active
Topics:
    - framework
    - contracts
DocType: report
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "What IRWB-040-B changed, why, and the acceptance evidence"
WhatFor: "Closing report of the F34 honest-evidence step"
WhenToUse: "Reviewing or building on the F34 fix"
---

# IRWB-040-B: F34 honest evidence — report

## The defect

Every invariant check the `AnalysisManager` records was stamped `assurance: 'checked'` (`invariantInternal`,
`src/framework/contracts/analysis-manager.ts`), whether it sampled five cases or exhausted a domain; the only
reader of `evidence.method`, `assuranceOf`, called anything that was not `sampled` exact — including missing
evidence and a misspelled method (R3's K3; probe 01 of IRWB-019's r3-synthesis).

## The change

A recorded check's assurance now says how it was checked:

- **`src/framework/contracts/types.ts`** — `Assurance` gains `'checked-sampled'` and `'checked-exact'`. Plain
  `'checked'` is redefined by a comment: a check whose evidence does not say how (no method, or one the
  framework does not know) — never an exactness claim. All existing comparisons (`=== 'declared'`, the
  analysis-record field `'checked' | 'transferred'`) are unaffected.
- **`src/framework/contracts/analysis-manager.ts`** — `assuranceOf` (moved here from `differential.ts`, next to
  the recorded checks it describes, avoiding a new import cycle) now recognizes only methods the framework
  knows: `sampled` (its own differential helper) → `checked-sampled`, `exhaustive` → `checked-exact`; anything
  else — missing evidence, a typo, an unknown name — → `checked`. `invariantInternal` stamps the recorded
  `CheckEvidence` with `assuranceOf(result.evidence)` instead of the constant `'checked'`, for pass and fail
  alike.
- **`src/framework/contracts/differential.ts`** — the old default-to-exact `assuranceOf` is replaced by a
  re-export from `analysis-manager.js`, so the `framework/contracts/differential.js` import path (used by the
  tests) keeps working.
- **`tests/framework/r3-defects.test.mjs`** — the F34 test's `todo` removed; no assertion changed.

Deliberately unchanged: the correspondence check in `beginTransformation` still records literal `'checked'`
(its evidence has no method — exactly what `assuranceOf` would say), and `AnalysisRecord.assurance`
(`'checked' | 'transferred'`, about cached analyses, not checks) is a different field.

## Why only two method names

Runtime check evidence in this repository carries a `method` only when produced by the framework's own
`differential()` (`'sampled'`); the typed rules' `structural`/`exhaustive-w8`/`random-32` names live in offline
rule-verification records that never flow through `checkInvariant`. `assuranceOf` therefore recognizes the
framework's own `'sampled'` and the conventional `'exhaustive'` (a checker that says it covered its domain).
Any future method the framework does not know records plain `'checked'` — the honest "we do not know how"
label — rather than silently claiming exactness. The fuller IRWB-039 design-doc line for F34 (records carrying
`method` and `scope`, Typed's rule strength flowing into pass evidence) stays for later steps; this step was
specified by the brief as the smallest fix the test and existing callers need.

## Acceptance (checked on the last commit)

- **The test**: `F34: sampled and exhaustive checks record different assurance; unknown evidence is never exact`
  passes without its `todo` (the 5-case sample records `checked-sampled`, the 256-case exhaustion
  `checked-exact`, and `assuranceOf(undefined)` / `assuranceOf({method:'typo'})` are `checked`, not exact).
- **The baselines**: `npm run build`, then `02-baselines.mjs check` → **no differences** (RV32 image hashes,
  instruction counts, edit records per pass, CUDA source hashes, `optimizeTix` revisions; timing informational).
- **The suites** (excluding `*-gpu.test.mjs`): framework 242 tests / 239 pass / 0 fail / 3 todo (F33, F35);
  typed 188 / 183 / 0 / 3 todo (F36–F38); workbench 25 / 24 / 0 / 0 (one pre-existing `IRWB_FULL`-gated skip);
  tensor 45 / 44 / 0 / 1 todo (F27). Every todo is another step's defect.
- `npm run check` (tsc) clean; `node tools/build-site.mjs` builds (src/framework changed).
- Prettier: the touched files that are not column-clean (`types.ts`, `differential.ts`) were already unformatted
  before this step (verified against `git show HEAD:`), so per the brief they were left alone;
  `analysis-manager.ts` passes `prettier --check`.

## Evidence

- Probe: `scripts/01-assurance-after-fix.mjs` (output in `01-assurance-after-fix.out.txt`): the sampled check
  records `checked-sampled` while its subject is wrong on every even input, the exhaustive one `checked-exact`,
  unknown evidence is `checked`, and a transformation contract's `ensures` check now carries `checked-sampled`.

WhatFor: ""
WhenToUse: ""
---
