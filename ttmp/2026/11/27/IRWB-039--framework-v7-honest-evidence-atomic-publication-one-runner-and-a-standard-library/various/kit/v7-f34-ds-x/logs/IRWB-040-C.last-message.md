Done. Worktree clean, two commits.

## Ticket and report

- Ticket: `ttmp/2026/11/27/IRWB-040-C--f34-honest-evidence-for-recorded-checks/`
- Diary: `…/reference/01-implementation-diary-f34-honest-evidence.md`
- Report: `…/reference/02-report-f34-honest-evidence-for-recorded-checks.md`
- Probe: `…/scripts/01-assurance-mapping.mjs`

## Changes, file by file

- `src/framework/contracts/assurance.ts` (new): `assuranceOf` — `sampled` → `checked-sampled`; `exhaustive`/`exhaustive-32`/`proof` → `checked-exact`; missing, non-string or unknown method → `checked` (never exact).
- `src/framework/contracts/analysis-manager.ts`: one import + `assurance: assuranceOf(result.evidence)` in `invariantInternal` (was the constant `'checked'`).
- `src/framework/contracts/differential.ts`: old `assuranceOf` body replaced by `export { assuranceOf } from './assurance.js';` (keeps the existing import path; no manager↔differential cycle).
- `src/framework/contracts/types.ts`: `CheckedAssurance = 'checked' | 'checked-sampled' | 'checked-exact'`; `Assurance` = `'declared' | CheckedAssurance | 'transferred' | 'proof'`.
- `src/framework/contracts/README.md`: assurance bullet list names the new values and says an unknown method is never exact.
- `tests/framework/r3-defects.test.mjs`: F34's `todo` removed (only other change is Prettier's re-indent of that block; `git diff -w` confirms).

## Acceptance (on the final code, re-run after the last code commit)

- **Test:** `✔ F34: sampled and exhaustive checks record different assurance; unknown evidence is never exact`, no `todo`.
- **Baselines:** `no differences from …/IRWB-039--.../various/baselines/main.json` (also `no differences` before the change; timing line is informational).
- **Suites:** framework 239 pass / 0 fail / 3 todo (F33×2, F35); typed 183 / 0 / 2 skipped / 3 todo (F36–F38); workbench 24 / 0 / 1 skipped; tensor without `-gpu` 44 / 0 / 1 todo (F27).
- `npm run check` clean; `node tools/build-site.mjs` → `dist/site built in 2335 ms … 132 source files`.

## Left out / judgement calls

- Left out the F34 row's "records carry `method` and `scope`" and "Typed's rule strength flows into a pass's evidence": neither is needed by the test, `scope` has no current producer, and Typed is out of scope. `assurance.ts` is the seam for the latter.
- `'checked'` (not a new `'checked-unknown'`) is the value for unknown evidence, because `tests/framework/contracts.test.mjs:46` asserts exactly `'checked'` for an invariant whose evidence is `{delta, tolerance}` and that test may not be edited; `'checked'` is distinct from `'checked-exact'`, which is all F34's assertions need.
- Typed's own method names (`structural`, `exhaustive-w8`, `random-32`) map to plain `'checked'`: `src/typed/rules/verify.ts` says 8-bit exhaustion implies nothing at 32 bits without the rule's argument, so the framework must not promote names it cannot read (the probe pins this).
- The test is weaker than the property (it never asserts *which* side is exact; `{method:'typo'}` and `{method:'exhaustive'}` both mapping to `'checked'` would still pass). Left as is; the probe covers the stronger claims.
- `src/framework/contracts/differential.ts` was already not Prettier-clean at HEAD (9 files are in that state), so I did not reformat it; my other touched files are clean.

Last commit: `0a65c5d` (code commit `8e3fd3e`).
