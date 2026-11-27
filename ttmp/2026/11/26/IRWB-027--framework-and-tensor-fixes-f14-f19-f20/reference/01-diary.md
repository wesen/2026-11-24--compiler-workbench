---
Title: Diary
Ticket: IRWB-027
Status: active
Topics:
    - framework
    - tensor
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T22:13:15.448718934-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## F14

Added assertions for changed, unchanged and rejected steps before implementation. `node --test tests/tensor/passes.test.mjs` initially could not find dist; after `npm run build`, it failed 2 of 6 tests: changed was absent (undefined instead of false, and missing from the changed step). The pass result already supplies changed; the contract error message supplies the first disagreement or the screening reason.

## F19

Before the fix, `node --test tests/tensor/cuda.test.mjs` failed the new concurrent test: two batches instead of one. The memo now shares pending per-case verdicts and removes them after either success or failure; the regression also checks a subsequent retry.
