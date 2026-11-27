---
Title: Order-preserving CUDA fusion
Ticket: IRWB-029-A
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T23:01:36.016422287-05:00
WhatFor: ""
WhenToUse: ""
---

# Order-preserving CUDA fusion

## Executive Summary

<!-- Provide a high-level overview of the design proposal -->

## Problem Statement

<!-- Describe the problem this design addresses -->

## Proposed Solution

<!-- Describe the proposed solution in detail -->

## Design Decisions

<!-- Document key design decisions and rationale -->

## Alternatives Considered

<!-- List alternative approaches that were considered and why they were rejected -->

## Implementation Plan

<!-- Outline the steps to implement this design -->

## Open Questions

<!-- List any unresolved questions or concerns -->

## References

<!-- Link to related documents, RFCs, or external resources -->

Lower the selected function of the current checked Tix revision. Calls use finite f32 inputs, consistent nonnegative affine shapes, in-bounds row-major addresses and sizes representable by the CUDA target, as in Stage 2. Empty extents, signed zeros, generated split bounds and nested reductions retain their existing meaning.

Put fusion in CUDA lowering, with an IR-derived schedule selected before code emission. Tix rewrites would need to encode thread ownership, barriers and storage in a language whose interpreter only needs tensor definitions. A kernel artifact would support later kernel-to-kernel passes, but this stage has one schedule producer and one consumer. The existing CUDA source artifact is the executable subject of the exact contract. Keep the ordered source statement names in the schedule and generated source. The generic IR correspondence can express grouped source and target IDs, but the CUDA text artifact has no kernel projection for the framework to trace.

Select contiguous groups with one externally visible result. Require every eliminated tensor to have a consumer within the group and no consumers outside it. Compare normalized symbolic shapes and resolved binder IDs. Use one of two mappings.

- With equal result shapes and identity-coordinate loads outside consumer reductions, keep one thread per output element. Store intermediate f32 values in locals. A contraction can feed this path because each output stays with the same thread, including when the epilogue reads it several times. Substituting the expression at every read would repeat the contraction.
- With rank-one and rank-two statements sharing the same leading dimension and a common row width, require internal loads to address the current output row. Use one block per row. Lanes stride across columns of pointwise stages, and lane zero evaluates the rank-one stages. Publish reusable row values to shared memory between stages, including barrier synchronization. Coalesce input loads for full-row folds by staging eligible external rows. Use device-backed row scratch when the requested shared storage exceeds the launch limit, so wide rows still use the same ordered schedule and one kernel definition. A whole-tensor intermediate would preserve order but retain global traffic and an extra launch.

Both mappings use the existing scalar emitter, including every rounding operation, reduction identity and sequential loop. The group planner declines candidates without those ownership and lifetime proofs. Keep the existing per-statement path for singletons and for `fuse: false`. Forward `benchmark` to the existing warmup and median-of-three implementation. Check the selected CUDA source through the existing exact GPU differential transformation. It samples shape and data cases, including empty extents, and compares shapes and f32 words with NaNs classified together.

Verify locally and through the isolated GPU tests. For each corpus program, measure both modes at the specified shapes and count per-kernel global traffic from the schedule and tensor dimensions. Report the ideal streaming time at 244 GB/s separately from event measurements. Contraction tiling, reassociation, FMA, tensor cores, streaming attention and autotuning are outside this stage because they require different scheduling or arithmetic decisions.
