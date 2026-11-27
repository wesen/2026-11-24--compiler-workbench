---
Title: Implementation diary
Ticket: IRWB-029-C
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T23:01:32.437017146-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Goal

<!-- What is the purpose of this reference document? -->

## Context

<!-- Provide background context needed to use this reference -->

## Quick Reference

<!-- Provide copy/paste-ready content, API contracts, or quick-look tables -->

## Usage Examples

<!-- Show how to use this reference in practice -->

## Related

<!-- Link to related documents or resources -->

## 1. Design

The user requested checked, bit-exact fusion and a committed design before implementation. Read the stage 1 and stage 2 designs and reports, framework contract and IR documentation, pass runner, tensor CUDA implementation, and remote runner. The existing CUDA lowering uses explicit f32 rounding and the exact sampled GPU contract. The implementation will plan fusion beside the emitter, retaining the stage-2 path.

The complete request is recorded in the session transcript. Ticket created with `docmgr ticket create-ticket` and documents with `docmgr doc add`.

## 2. Partial implementation and measurement

Exposed fuse and benchmark options and reused the existing resolved-IR inline machinery for single-use pointwise producers and coordinate-matched reduction epilogues. Build passed. A focused GPU check accepted the reduction epilogue under the exact relation. The original tensor suite produced 32 passes and one failure because its source-count assertion assumed the old default; updating that test to request `fuse: false` and rerunning focused tests passed.

Measured all six cases using the numbered benchmark script. The first MLP fused measurement was 23.09 ms because the pointwise producer was recomputed inside a contraction. Restricted that case and remeasured attention and MLP. The partial report records results and outstanding row fusion and byte accounting. The changes do not fulfill the entire stage.
