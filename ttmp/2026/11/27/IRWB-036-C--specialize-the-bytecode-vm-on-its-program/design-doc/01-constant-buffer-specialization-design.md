---
Title: Constant-buffer specialization design
Ticket: IRWB-036-C
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:44:02.649525743-05:00
WhatFor: ""
WhenToUse: ""
---

# Constant-buffer specialization design

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

## Scope and decisions

The supported inputs are Typed programs with a read-only buffer parameter, a finite fixed cell sequence supplied by the host, and scalar bindings. The VM's valid bytecode executions terminate and access valid indices. The promise restricts the meaning contract to calls with those cells, just as a scalar binding restricts generated cases; it is not a runtime guard. A runtime comparison and fallback would preserve the unrestricted contract but adds a second execution path and per-call cost.

Represent the buffer as an outer binding with its function, parameter, cells and provenance. Feed those cells into generated cases and use the existing pass transaction and meaning check. Reject a binding when writes or aliases cannot be shown safe; direct constant-index reads can then become constants. This is simpler than a whole-program alias analysis, although it may leave useful programs unspecialized. Undo must restore assumptions with revisions.

The dispatch loop needs multiple residual states: each known program counter selects one static opcode, but a dynamic conditional can revisit a previous counter. Explore specializing CFG states keyed by known locals, reusing an existing state on a backedge. Stop at unknown addresses or effects that invalidate the buffer promise, and use a bounded state budget to prevent unbounded growth. A straight-line unroller is simpler but cannot represent the VM's dynamic iteration count. The existing optimizer should simplify each state; all edits must retain correspondence and the normal generated-case meaning contract. Measure this approach before claiming it works, including code size and both fixture entries.

## Verification and measurement

Use focused tests for matching and mismatching buffers, alias/write safety, dynamic branches, backedges, and undo. Compare execution with the original and count RV32 instructions and image size at n=12, seed=8, using the same backend settings for general, specialized and hand-written implementations. Run required Typed, framework and workbench tests before the final commit. Any framework change will be listed with its reason. If a proposed component cannot be implemented safely in this session, report it as incomplete rather than claiming the corresponding measurements.

## Later

- General alias analysis and runtime guarded fallback.
