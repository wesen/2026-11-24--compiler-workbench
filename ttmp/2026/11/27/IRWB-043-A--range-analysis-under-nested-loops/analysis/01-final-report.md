---
Title: Final report
Ticket: IRWB-043-A
Status: active
Topics:
    - compiler
    - analysis
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/dataflow/analysis.ts
      Note: Region context for widening
    - Path: repo://src/framework/dataflow/lattices.ts
      Note: Interval widening with thresholds
    - Path: repo://src/typed/analyses.ts
      Note: Per-function thresholds and range widening
    - Path: repo://tests/typed/d2-defects.test.mjs
      Note: F37 regression
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T17:27:46.319974539-05:00
WhatFor: ""
WhenToUse: ""
---

## Finding and fix

An inner loop widens the upper bound of the outer counter. The subsequent increment may overflow i32 according to the interval evaluator, which returns the full interval; the minimum then propagates to the outer head. The interval lattice already widens bounds independently, so that alone is insufficient.

Use widening with thresholds: collect integer constants from each function, together with zero and the i32 endpoints, and widen each moving bound to the nearest enclosing threshold. The threshold set is finite and each widened bound encloses both the old and incoming bounds. The framework supplies region context to widening and implements the threshold operation in its interval lattice; another interval analysis can supply its own thresholds. Ordinary widening to extrema is simpler but lost the bound. A narrowing experiment did not recover it: F37 still observed the minimum. A hard-coded 64 threshold passed the experiment, but program-derived thresholds avoid specializing the analysis to chess.

## Evidence

- `npm run build`: passed; F37 focused test: 1 pass, 0 failures.
- Interval threshold test: 1 pass, 0 failures.
- `npm run check` and `node tools/build-site.mjs`: passed.
- Baseline check reported only `typed.chess-search.speed.image` changing from `12d8744b6c5a7c04` to `90252eb4fa3731fc`, `strength` edits 58 to 60, and `guards` edits 4 to 2. The more precise counter permits strength reduction; the later guards edit difference is consistent with the changed IR, although the individual edits were not traced. Neither measured instruction count changed. The check exits 1 because it reports these permitted differences.
- `node tools/parity.mjs`: 8,286/8,286 decided cases agree, 14 inconclusive, 0 failures across 50 projects.
- Combined requested non-GPU suites: 500 tests, 489 pass, 1 fail, 3 skipped, 7 TODO. The separately added threshold test passed (1/1). The sole non-TODO failure is `tests/typed/guards.test.mjs:198`: it asserts that `strength` does not change the counter, explicitly because of the F37 range defect. With the fix it does change it (`true !== false`). The brief says to leave an assertion in place if it is believed wrong, so this conflicting assertion remains. The all-suites-pass acceptance cannot simultaneously hold with that instruction and the intended optimization.

No general narrowing phase was added: the experiment did not fix this case, and threshold widening supplies the needed precision with a finite, per-function set.
