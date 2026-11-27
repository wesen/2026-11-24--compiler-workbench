---
Title: Implementation diary
Ticket: IRWB-032
Status: active
Topics: []
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:26:45.660802344-05:00
WhatFor: ""
WhenToUse: ""
---

## F24

Before the fix, `npm run build && node --test tests/tensor/cuda.test.mjs` failed the new regression: the malformed statement ID was accepted (`true !== false`). Added IR entity inventories and declared them in the lowering correspondence.

## F25

Before the fix, `node --test tests/tensor/gate-choice-gpu.test.mjs` failed on the GPU: `result.gates` was undefined instead of `{ k0: 'fused' }`. The generated host now writes its computed choices alongside each result.

## F26

Before the fix, `node --test tests/framework/ext-e5.test.mjs` failed with “Missing expected exception” when cases changed under `fixed-key`. On a reuse hit, regenerate with the same seed and compare the complete cases before reusing the cached outcomes.

The benchmark script `scripts/01-measure.mjs` compares warm reuse checks with the same generated cases held constant versus regeneration and deep comparison, 20 iterations each. Typed `blend`: 0.095 versus 1.482 ms/check; tensor reduction: 0.030 versus 1.964 ms/check. This is significant for warm cache hits. A cheaper alternative would be an opt-in audit mode that regenerates cases, though it would not detect violations on every production reuse. The measurements omit GPU execution and are not end-to-end pipeline timings.

The local non-GPU corpus lowering checks pass fused and unfused. The GPU gate regression passes for both choices. The first broad run passed 420 tests, skipped 2.
