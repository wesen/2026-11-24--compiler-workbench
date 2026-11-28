---
Title: Staged launch choice
Ticket: IRWB-062
Status: active
Topics:
    - compiler
    - framework
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-28T01:49:14.293579165-05:00
WhatFor: ""
WhenToUse: ""
---

# Staged launch choice

Use one ordered launch select on schedule kernels, with gate arms and variant arms. Each arm carries its launch predicate and the mode that forces it. The supported domain is the existing CUDA host ABI: a binary fusion gate and indexed contraction variants with tiled fit checks, nonnegative integral block and term bounds, and an unconditional plain variant. The contraction arm uses the existing field spelling because the contraction printer outside this lane already reads those fields directly. The row printer consumes the gate arm's policy constants and heavy members.

Project the select into each manifest entry. Keep the existing gate and variant summaries for CUDA artifact validation and correspondence evidence. The differential derives ordered sets of forcing values from the arms. Cycle the shorter set over the longer so every arm has a mode, including both gate sides if there is only one variant. A Cartesian product would add checks and change existing modes without improving arm coverage. Global flags suffice for this coverage. Forced tiled arms still require the existing fit condition in CUDA.

Use a structural coverage check at schedule validation and loop-plan eligibility. A tiled predicate is an upward-closed set in blocks per SM and terms, conditional on that variant fitting. On the launch-statistics domain with independent per-variant fit and grid values and shared terms, the least point of an arm detects shadowing by an earlier predicate for that variant. An earlier unconditional arm shadows every subsequent arm. If all tiled variants fail to fit, only the unconditional plain arm accepts the launch. The binary gate has a guarded arm and a fallback by construction. A search over concrete tensor shapes and device limits would need a separate feasibility model.

The schedule keeps the existing strategy plans, pass runner and correspondence. A general binding-time strategy node would duplicate work until there is a second client that needs to keep alternatives past optimization.

## Later

- Add concrete shape and device feasibility analysis if schedule policies need to reason about correlations between variant grids.
- Add a framework staged strategy node if another client needs the same binding-time representation.
