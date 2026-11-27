---
Title: Measuring the cost of each revision
Ticket: IRWB-034-B
Status: active
Topics:
    - compiler
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:44:10.935659164-05:00
WhatFor: ""
WhenToUse: ""
---

# Measuring the cost of each revision

## Measurement and decision

Accept a linear timeline of published Typed revisions starting at r0, an entry and concrete guest arguments and memory on which every image finishes with counters, and one fixed set of backend options. Lower and execute every revision. Attribute the signed difference between adjacent execution totals to the checked pass that produced the later revision. This captures backend consequences even for untouched statements. Endpoint comparison alone cannot identify when the regression first appeared.

Retain per-instruction counts and the backend's covers, rule and lowering information. Use revision edits and correspondence at the costly transition to find the decisions that changed hot code. Compare a run with that decision suppressed to distinguish its cost from later pass interactions. Summing heat for every covered entity would count a fused instruction more than once.

Prefer a local profitability change if the evidence identifies a recognizable bad decision. A whole-strategy race against r0 is simpler to describe but pays for extra compilations and depends on the quality of training inputs.

## Acceptance

Reproduce the two IRWB-012 fixtures with coalescing, measure r0, O2 and speed, and check that both fixed speed runs cost at most r0. Compare O2 and speed on identical seeded project cases across the corpus, including traps and reporting any unavailable measurements. Use the project's established 10 cases and seed 7 from typed.metrics. Exercise the reusable function in a test, run corpus parity, reference comparisons and the requested test groups.

## Later

Searching for missed optimizations can consume the measured transitions and hot instruction evidence. This stage diagnoses regressions on concrete runs.
