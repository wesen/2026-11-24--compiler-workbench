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

## F20

Before the fix, `node --test tests/tensor/cuda-remote.test.mjs` failed because adding link options left the build hash unchanged. The GPU probe with `--link cublas` also failed at link time with undefined references to cublasCreate_v2, cublasSgemm_v2 and cublasDestroy_v2.

After the fix, the local link regression passed. The untimed GPU probe exited 0 and printed `cuBLAS matches CPU: 58 139 64 154` (compiled true). Final validation: `npm run build` passed; `node --test tests/framework/*.test.mjs tests/tensor/*.test.mjs` passed 260 tests, 0 failed, 0 skipped. F14 is commit 20da152; F19 is commit 6d6321b.
