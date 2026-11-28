Done. Both defects fixed, all acceptance checks run.

## Ticket and report

- Ticket: `ttmp/2026/11/27/IRWB-042-C--two-typed-pass-defects-bce-by-value-lvn-s-absent-value/`
- Report: `…/reference/02-report-two-typed-pass-defects-f36-f38.md`; diary: `…/reference/01-implementation-diary.md`; probes: `…/scripts/01-bce-sites.mjs`, `02-bce-defect-program.mjs`; check logs: `…/various/03-07*.log`

## Changes, file by file

- `src/typed/passes.ts` — **`bce`**: declares `ssa` as a need and compares the **SSA names** (`ssa.uses`) of the index reads and of the buffer reads at the branch and at the check instead of the reaching-definition *sets*; `resolve` returns only value + local (its statement id existed for the old set comparison).
- `src/typed/passes.ts` — **`lvn`**: new helper `rebuildParents` plus one line after a firing that drops the `seen` entries pointing at values the firing's `tx.replace` rebuilt (those ids are dead, which is what threw `absent`).
- `tests/typed/d2-defects.test.mjs` — F36 and F38 lost their `todo` (assertions untouched); header notes F37 is still a todo.

## Acceptance

- **Tests:** `F36…` ✔, `F38…` ✔ — `pass 2, fail 0, todo 0`.
- **Baselines:** `no differences from …/various/baselines/main.json` (so no project changes; no project is slower). Expected: `bce` still accepts the same 13 corpus sites, and `lvn`'s change only affects entries it threw on.
- **Suites:** typed 188 tests / 185 pass / 0 fail / 2 skipped / 1 todo (F37); framework 242 / 238 pass / 0 fail / 4 todo; workbench 25 / 24 pass / 0 fail / 1 skipped; tensor (no `*-gpu`) 45 / 44 pass / 0 fail / 1 todo.
- `npm run check` clean; `prettier --check src/typed/passes.ts` clean (the 9 files `format:check` warns about were already unformatted); `build-site` not run — `src/framework/` and `src/workbench/` untouched.

## Notes

- Probe 01 is the reason the fix is SSA names and not a stricter set rule: at 13/13 corpus sites the reaching sets are *equal but not singletons* (loop counters), so "same singleton" would have deleted every bounds-check elimination and made 13 projects slower. Probe 02 shows the defect: sets `{s:walk.0 s:walk.5}` on both sides, names `i.2` vs `i.4`.
- F38's cause: `tx.replace` rebuilds every parent of the replaced value with a fresh id; `lvn`'s `seen` still held such a parent (`v:regexMatch.587`) from the same statement it had just fired in.
- Left out: adding the second `lvn` to `speed` (a pipeline decision, pinned lists; IRWB-037-G measured 1,010 instructions on five projects); F37 is IRWB-043-A. The second `lvn` is now applicable but no pipeline was changed.
- I did not find anything wrong in the brief or in either test.

Last commit: `17ba8e3` (`src/` in `bcee796`, both working).
