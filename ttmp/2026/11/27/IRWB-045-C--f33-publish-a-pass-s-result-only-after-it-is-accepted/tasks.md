# Tasks

## DONE

- [x] Probe before the change: `scripts/01-publication-before-acceptance.mjs`
- [x] Design: `design-doc/01-publish-a-pass-result-only-after-it-is-accepted.md`
- [x] `src/framework/ir/store.ts`: `IRStore.publish`, `#publish` with an optional base
- [x] `src/framework/passes/define-pass.ts`: private preparation, deferred contract, rollback, one publication
- [x] `tests/framework/r3-defects.test.mjs`: remove the two `F33:` `todo` options (assertions unchanged)
- [x] Probe after the change, plus `scripts/02-accepted-publication.mjs` for the accepted side
- [x] Suites, baselines check, `npm run check`, `node tools/build-site.mjs`
- [x] Report: `reference/02-report-f33-publication-only-after-acceptance.md`

## TODO

- [ ] Wire a caller (the workbench revision timeline) through `ApplyOptions.store`, so publication into a store is
      exercised outside the tests
- [ ] Decide whether a stale head should be a `PassError` code rather than `ir.stale-edit`
