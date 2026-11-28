All acceptance checks pass on the last commit. Final summary:

## Ticket and report
- **Ticket:** `ttmp/2026/11/27/IRWB-040-B--f34-honest-evidence-a-recorded-check-s-assurance-says-how-it-was-checked/`
- **Report:** `.../report/01-report-f34-honest-evidence.md` (diary: `.../diary/01-diary-f34-honest-evidence.md`; probe: `.../scripts/01-assurance-after-fix.mjs` + `.out.txt`)

## What changed, file by file
- `src/framework/contracts/types.ts` — `Assurance` gains `checked-sampled` and `checked-exact`; a comment fixes plain `checked` as "evidence does not say how — never an exactness claim".
- `src/framework/contracts/analysis-manager.ts` — `assuranceOf` moved here (next to the recorded checks it describes, avoiding a new import cycle) and made honest: `sampled` → `checked-sampled`, `exhaustive` → `checked-exact`, missing/unknown/misspelled → `checked`; `invariantInternal` now stamps the recorded `CheckEvidence` with `assuranceOf(result.evidence)` instead of the constant `'checked'`.
- `src/framework/contracts/differential.ts` — the old default-to-exact `assuranceOf` replaced by a re-export from `analysis-manager.js`, so the `differential.js` import path the tests use keeps working.
- `tests/framework/r3-defects.test.mjs` — the F34 test's `todo` removed; no assertion touched.

## Acceptance (on last commit `2489382`)
- **The test:** ✔ `F34: sampled and exhaustive checks record different assurance; unknown evidence is never exact` — passes without `todo` (sampled records `checked-sampled`, exhaustive `checked-exact`; `assuranceOf(undefined)` and `assuranceOf({method:'typo'})` are `checked`, not exact).
- **Baselines:** `02-baselines.mjs check` after `npm run build` → **"no differences"**.
- **Suites** (excluding `*-gpu.test.mjs`): framework 242 tests / 239 pass / **0 fail** / 3 todo (F33, F35); typed 188 / 183 / **0 fail** / 3 todo (F36–F38); workbench 25 / 24 / **0 fail** / 0 (one pre-existing `IRWB_FULL`-gated skip); tensor 45 / 44 / **0 fail** / 1 todo (F27). All todos are other steps' defects.
- `npm run check` clean; `node tools/build-site.mjs` builds (src/framework changed).

## Notes and things left out
- Only two method names are recognized (`sampled`, `exhaustive`): runtime evidence in this repo carries a `method` only from the framework's own `differential()`; the typed rules' `structural`/`exhaustive-w8`/`random-32` names live in offline rule-verification records that never flow through `checkInvariant`. An unknown method (now and in future) records plain `checked` — honest, never exact.
- Deliberately unchanged: the correspondence check in `beginTransformation` still records literal `'checked'` (its evidence has no method, exactly what `assuranceOf` would say), and `AnalysisRecord.assurance` (`'checked' | 'transferred'`) is a different field about cached analyses. The broader IRWB-039 design-doc line for F34 (records carrying `method` and `scope`; Typed rule strength flowing into pass evidence) is later steps' work.
- Prettier: the two touched files that aren't column-clean (`types.ts`, `differential.ts`) were already unformatted before this step (verified against `git show HEAD:`), so per the brief they were left alone; `analysis-manager.ts` passes `prettier --check`.
- Nothing in the brief or the test looked wrong.

**Last commit:** `2489382`
