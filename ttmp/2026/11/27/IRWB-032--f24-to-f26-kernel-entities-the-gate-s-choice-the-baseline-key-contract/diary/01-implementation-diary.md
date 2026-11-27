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
