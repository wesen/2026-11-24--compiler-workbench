# Tasks

## Done

- [x] Baseline: the three benchmarks and the corpus, with the reference column (scripts 01, 08)
- [x] The hot-shape tool: `src/typed/missed.ts`, `tools/missed.mjs`, corpus tables (scripts 06, 07)
- [x] The gap to the reference joined by execution count (script 04)
- [x] Design, committed before the implementation
- [x] Passes `thread`, `copies`, `guards`, `subst-mem`, in `speed`
- [x] Framework: `src/framework/dataflow/scoped.ts`
- [x] Rule candidates verified and measured (scripts 11, 16); table `identities` with recorded evidence (17)
- [x] Ablation per pass (script 09), corpus before and after (08, 19), full checks (18, 21)
- [x] Tests: `tests/typed/guards.test.mjs`, `missed.test.mjs`, `tests/framework/scoped.test.mjs`
- [x] Report and diary

## Open (see "Later" in the report)

- [ ] The new passes in O2 need the book's numbers and listings updated
- [ ] bce by SSA names; `typed.ranges` under inner loops; lvn's `absent`
- [ ] A template number over a literal and a constant variable in `rules/form.ts`
