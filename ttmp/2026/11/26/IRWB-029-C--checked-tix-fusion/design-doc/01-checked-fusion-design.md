---
Title: Checked fusion design
Ticket: IRWB-029-C
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
LastUpdated: 2026-11-26T23:01:26.020626678-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked fusion design

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

## Scope and decision

Inputs are valid Tix programs and calls in the stage-1 domain, with finite inputs and consistent, nonnegative dimensions. The existing exact CUDA contract compares the current f32 meaning with GPU results; NaNs compare as a class.

Plan fusion from resolved Tix statements immediately before emission. Preserve every scalar operation and ordered reduction; only remove materialization when dependency and indexing prove it safe. A Tix rewrite is simpler for pointwise inlining, but cannot represent a staged row kernel or its thread mapping. A separate kernel artifact would provide inspectable correspondence, but adds an IR and adapter for one backend; emitter-local planning is the smallest current implementation. Framework grouped correspondence can represent many-to-one relationships, but this emitter does not create an inspectable kernel artifact to attach it to. This is a framework integration finding.

Fuse pointwise chains and reduction epilogues when the consumer accesses the producer at the corresponding output coordinates and removing the materialization does not duplicate expensive work. For row pipelines, stage each row in shared memory with coalesced loads, synchronize, then execute each reduction sequentially in index order; retain per-element rounding. Refuse cases whose index mapping, reuse, or dependencies cannot establish this order. Preserve the original emitter for `fuse: false`; expose benchmark mode through the existing batch runner.

The contract samples deterministic shapes and values and compares every output bit, including signed zero, with NaNs as a class. It is evidence on samples, not a proof of all shapes or inputs. Test ordinary lowering without GPU separately from GPU contract checks; measure each corpus at the specified shapes using the timed lock. Count logical global reads and writes by emitted kernel, and divide by 244 GB/s as a bandwidth reference.

## Later

- Reassociated reductions, contraction tiling, FMA, tensor cores, streaming attention and autotuning are outside this stage.
- A kernel artifact with explicit statement-to-kernel correspondence could make scheduling visible to framework tools.
