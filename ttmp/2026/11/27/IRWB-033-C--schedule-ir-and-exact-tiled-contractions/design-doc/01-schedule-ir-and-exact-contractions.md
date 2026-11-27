---
Title: Schedule IR and exact contractions
Ticket: IRWB-033-C
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:04:12.972303667-05:00
WhatFor: ""
WhenToUse: ""
---

# Schedule IR and exact contractions

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

## Scope and design

The supported domain is the existing checked Tix core with consistent nonnegative shapes, finite inputs and in-bounds accesses that fit the GPU. The fallback covers every accepted program and all extents, including zero and partial tiles. The `fuse: false` path remains the stage-2 implementation.

A schedule artifact contains the selected function and fusion groups, including their gate, staged terms and row reuse. The existing fusion planner supplies these decisions: rewriting its well-tested dependence analysis as new passes adds risk without improving the required contraction schedule. The schedule records each kernel's execution mapping and storage decisions, with a serial reduction descriptor preserving the ordered binders and separately rounded operations. A direct Tix-to-CUDA emitter is simpler but leaves the scheduling decisions inaccessible to pass checks.

The first candidate tiled mapping recognizes a two-dimensional output and a single ordered sum of two affine loads. Each block stages tiles of both operands into shared memory, threads hold output accumulators, and K tiles and elements are visited in ascending order. Boundary loads are guarded; an incomplete tile never adds padded terms. A pass may install this mapping only after checking the expression, indexing, ownership and dependency conditions. Inputs remain immutable and each output has one owner. Register tiling can follow as a separate pass once this mapping is measured. Unsupported forms and fused groups retain their existing implementation. These restrictions apply only to the optimized schedule, not the accepted language.

Each schedule rewrite is a v6 pass with an artifact correspondence. A structural check compares the computation and ordered reduction descriptor before and after, and checks the pass-specific mapping legality. This checks the represented order, not correctness of CUDA generation, synchronization, addressing or compiler behavior. The existing exact differential GPU check remains the end-to-end check, including both sides of the fusion gate. It is sampled evidence rather than a universal proof. A GPU-only check per scheduling step is simpler but cannot establish general order preservation and is expensive.

The public source API is synchronous; the framework strategy interpreter is asynchronous. A synchronous deterministic strategy applies the schedule passes and uses shape-dependent launch predicates where runtime dimensions are required. The framework strategy is preferable for asynchronous multi-candidate searches, but converting the public API or adding a second scheduler would change the fixed surface. Any framework changes needed to make passes or correspondence work across the two IR kinds will be recorded individually.

The paper by Yang et al., [Taming Bitwise Behavior in GPU Kernels with Tensor Core](https://arxiv.org/abs/2609.11356), separates arithmetic order from layout and checks equivalence of compiled kernels. Here the reference is Tix's serial, separately rounded arithmetic, not cuBLAS's FMA-based order. A descriptor plus a structural verifier is a smaller first step; it does not establish instruction-level equivalence.

Measure using five alternating benchmark calls per variant, with differences below five percent treated as noise. Retain raw measurements and scripts in this ticket. Compare every corpus program to the prior report and the unfused path, and report missing measurements explicitly. The stage's goal includes contractions within fused groups; merely optimizing singleton matmul is not completion.

## Later

- Reassociation, split-K, parallel tree reductions, FMA and tensor cores require a different arithmetic equivalence class.
- Measurement-driven autotuning is outside this stage.
