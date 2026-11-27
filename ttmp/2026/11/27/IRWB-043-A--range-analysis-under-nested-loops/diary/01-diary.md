---
Title: Diary
Ticket: IRWB-043-A
Status: active
Topics:
    - compiler
    - analysis
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T17:27:46.273149939-05:00
WhatFor: ""
WhenToUse: ""
---

## Step 1: Investigate and apply a widening threshold

The framework interval lattice already widens each moving bound independently. At a nested head, a later outer-loop iteration can lower the observed non-negative counter bound, causing ordinary widening to send it to the i32 minimum. I tried zero as a widening threshold, retaining ordinary widening once either lower bound is negative. This is an over-approximation and has a finite number of widening steps.

The requested F37 regression was enabled without changing its assertion. The initial parallel validation overloaded the machine; the focused test process ended with a generic test failure without assertion detail, and the other jobs were interrupted. Validation was restarted with less concurrency. `npm run check` passed.

Review `src/typed/analyses.ts` at `rangesAnalysis.widen` and `tests/typed/d2-defects.test.mjs`. A narrowing phase is a more general alternative, but requires solver support and additional iterations; the single threshold directly addresses the observed loss.

## Step 2: Measure the cause and select thresholds

The first threshold experiment retained only a non-negative lower bound and failed F37: `dense's lower bound is -2147483648`. A subsequent narrowing experiment also failed the same assertion. The chess probe showed the outer header already at the full i32 interval. The inner loop can widen the upper bound before the outer increment; a potentially overflowing increment yields the full interval, feeding the minimum back to the outer head.

A diagnostic widening threshold at 64 plus zero passed F37 (one pass, no failures); 64 came from the chess loop guard and was used only for the experiment. The implementation instead collects integer constants from the function, adds zero and the domain endpoints, and uses the nearest enclosing threshold on each growing bound. Its finite threshold set ensures eventual widening to the endpoints. The shared interval lattice implements the operator, and dataflow analyses receive the region context at widening. Another interval analysis can supply its own guard thresholds.

After moving the operator to the framework, `npm run build` and the isolated F37 test passed (1 pass, 0 failures). `node --test tests/framework/interval-thresholds.test.mjs` passed (1 pass, 0 failures). A TypeScript check and site build passed before the final lattice cleanup; acceptance checks are being rerun on the final code.

## Step 3: Acceptance

The corpus comparison showed only the allowed chess-search speed differences recorded in the report, with unchanged instruction counts. Parity passed all 8,286 decided cases. The non-GPU suites completed with 489 passes, one failure, three skips and seven TODOs; the one failure asserts the old F37 defect in `tests/typed/guards.test.mjs:198`, so the assertion was left untouched as requested. The new interval test passed separately. TypeScript and site builds passed.
