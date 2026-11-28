**Done.** F33 is implemented, verified, and documented.

## Ticket and report
- Ticket: `ttmp/2026/11/27/IRWB-045-B--f33-publish-a-pass-s-result-only-after-it-is-accepted/`
- Design: `design-doc/01-one-acceptance-boundary-for-a-pass-application.md`; diary: `reference/01-implementation-diary.md`; report: `reference/02-final-report.md`; evidence: `scripts/01-acceptance-boundary.mjs` (R3 probe 03 scenarios + an accepted-with-store control)

## What changed
- `src/framework/passes/define-pass.ts` — `prepareNative` opens the candidate on a private store (no caller store); `applyPass` runs the contract with `deferCommit: true`, then one boundary: preservation checks → `prepared.commit()` → `store.retain(after)` (native results only), with rollback + `invalidate` of candidate-evidence on any rejection; header comment updated.
- `tests/framework/r3-defects.test.mjs` — both F33 tests' `todo: 'F33'` removed; they pass unmodified otherwise.
- `applyNativePassSync` needed no logic change (no manager, already-private store); both runners keep their accepted results.

## Acceptance results
- **Tests:** `r3-defects.test.mjs`: tests 4, pass 2, todo 2 (F34/F35, other steps) — both F33 tests green as real tests.
- **Baselines:** `02-baselines.mjs check` → `no differences`.
- **Suites** (gpu excluded, 0 failures): framework 21 files / 242 tests, typed 34 / 173, workbench 5 / 25, tensor 7 / 45 — non-passing items are only other steps' todos and pre-existing `IRWB_CANDELA`/`IRWB_FULL` skips.
- `npm run check` clean; `node tools/build-site.mjs` builds; Prettier clean on changed files.

## Notes / caveats
- Rejection leaves tombstones (invalidated candidate evidence, discarded overlay facts), matching the manager's own `discard()` idiom — no *valid* fact or accepted execution survives. A public provisional-scope concept in the manager would remove even the brief visibility; left as "Later" (a scope frame would have to pre-declare transitively used effects).
- Store-protocol edge: (caller store × same artifact id × changed revision) now gets `ir.unpublished` after the checks instead of before, and a contract rejection wins; no current caller uses that combination.
- Nothing in the brief or the tests looked wrong to me.
- Last commit: **`9309592`** (code commit: `d663826`, design: `89103af`)
