---
Title: Final report
Ticket: IRWB-063
Status: active
Topics: [framework, compiler]
DocType: reference
---

# Report

The shared runtime coverage check is implemented and exercised by both callers. The single-type objective remains incomplete: contracts/types.ts defines CorrespondenceCoverage and passes/define-pass.ts imports DerivationCoverage, but the brief excludes both files. The intern guide includes contracts/types.ts. Scope clarification was requested. The existing type was restored to leave the scoped checkpoint buildable; the two pre-existing declarations remain.

- `src/framework/ir/correspondence.ts`: shared coverage policy and checker.
- `src/framework/ir/derivation.ts`: use the checker on explicit entries for nonempty and completed entries otherwise.
- `src/framework/contracts/analysis-manager.ts`: use the checker for contract correspondence coverage, preserving error messages.
- `tests/framework/correspondence-entities.test.mjs`: direct tests for policies and empty sides.

Validation: `npm run build`, `npm run check`, and `node tools/build-site.mjs` passed. Baseline check: `no differences`. The combined non-GPU suite reported 79 passing files and four failing files; rerunning those four outside the sandbox passed 15 tests, with one conditional skip. The sandbox failures involved `spawnSync .../node EPERM`, and the reference test failed parsing the empty subprocess output. Targeted derivation and F35 tests passed. No existing assertion changed. The GPU suite was intentionally excluded.
