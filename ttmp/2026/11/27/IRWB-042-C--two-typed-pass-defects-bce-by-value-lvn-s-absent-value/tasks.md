# Tasks

## Done

- [x] Reproduce F36 and F38; baseline check on the unmodified source (`no differences`, 11m19s)
- [x] F36: `scripts/01-bce-sites.mjs` — every bce candidate site in the corpus and what each candidate criterion accepts
- [x] F36: `scripts/02-bce-defect-program.mjs` — the test's program: equal reaching sets, different SSA names
- [x] F36: `bce` compares the SSA names of the index and buffer reads (needs `ssa`)
- [x] F38: locate the dead value (temporary instrumentation, reverted) and name the cause
- [x] F38: `lvn` drops the `seen` entries a firing rebuilds (`rebuildParents`)
- [x] Remove `todo` from the two tests in `tests/typed/d2-defects.test.mjs`
- [x] Diary (`reference/01-implementation-diary.md`) and report
- [x] Baselines check after the fix; the typed, framework, workbench and tensor suites; `tsc`; Prettier

## Open (see "Later" in the report)

- [ ] The second `lvn` before `rotate` is applicable but not added to `speed`: with it the speed pipeline is longer and
      the pipeline lists are pinned in tests; IRWB-037-G measured 1,010 instructions on five projects.
- [ ] F37 (`typed.ranges` under inner loops) is a separate ticket (IRWB-043-A).
