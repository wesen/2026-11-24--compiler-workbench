# Changelog

## 2026-11-27

- Initial workspace created
- Added `src/framework/ir/derivation.ts`: a derivation step (rule or decision, site, premises, relation), the site
  check, `correspondenceFromDerivation` under F35's coverage vocabulary, and the two locality policies as queries.
- Typed records rule ids (`Tx.withRule`, `rules/compile.ts`, `Edit.steps`); Tix `inline` records its merges
  (`mergedInto`). The correspondence is computed from the steps and equals `revisionCorrespondence` on every corpus
  revision (O2 and `speed`, 547 applications).
- 183 O2 edit records cite a verified rule (0 before); the policies answer 203 (scoped) and 393 (in-place, G's 395 minus
  two fold records, explained). O2 corpus cost 0.99x the base build.
- Tests: `tests/framework/derivation.test.mjs`, `tests/typed/derivations.test.mjs`; `tests/typed/rules.test.mjs` updated
  for the attribution the table-driven passes now carry.
- Baselines check: no differences. Suites: framework 266/266, typed 192/194 (2 skipped), tensor+stdlib+workbench
  383/384 (1 skipped).
