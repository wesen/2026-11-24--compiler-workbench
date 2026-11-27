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

## F26 review: browser build

`node tools/build-site.mjs` reproduced the failure: esbuild could not resolve `node:util`. The new regression in `tests/framework/ext-e5.test.mjs` initially failed because a changed case raised a bare `Error`; it also checks a mutated typed array and signed zero. Replaced the Node-only comparison with a stored digest of a canonical projection of the cases; typed-array bytes and special numbers are preserved. A mismatch now raises `ContractError` naming the key. The browser build passed after the change.

Re-ran `scripts/01-measure.mjs` (20 warm iterations). With the digest implementation, Typed blend took 5.144 ms/check and the tensor reduction took 1.964 ms/check with regenerated cases. The earlier recorded pre-detection warm baselines were 0.095 and 0.030 ms/check respectively, suggesting approximately 5.05 ms and 1.93 ms added. These are small local samples from separate runs, not end-to-end timings; the current script's cached-case mode still hashes cases and therefore is not a zero-detection baseline.

A more direct comparison uses `scripts/02-compare.mjs`, which probes esbuild's TypeScript transform and a data-URL module successfully, reconstructs the previous implementation with its detection removed, and measures both paths in the same process. After the suite finished, 20 warm checks averaged 0.025 ms without versus 4.153 ms with detection for Typed, and 0.008 versus 1.663 ms for tensor. The increases are approximately 4.13 and 1.66 ms per check, respectively. These samples are local and omit GPU execution. An opt-in audit mode would be cheaper but would not check every reuse.

Validation: `npm run build` and `node tools/build-site.mjs` passed; the requested framework, Typed, non-GPU tensor, and new GPU test selection finished with 423 passed and 2 skipped (425 total).
