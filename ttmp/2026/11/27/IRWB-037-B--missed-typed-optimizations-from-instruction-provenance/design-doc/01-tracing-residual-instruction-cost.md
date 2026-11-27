---
Title: Tracing residual instruction cost
Ticket: IRWB-037-B
Status: active
Topics:
    - typed
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T12:39:42.472049308-05:00
WhatFor: ""
WhenToUse: ""
---

# Tracing residual instruction cost

## Experiment

Start at 2966b9b. The input domain is a Typed program accepted by the existing pipeline and a concrete call that finishes at each measured revision. Use the regex, compression and chess fixtures with their original backend settings. For corpus comparisons use D1's ten generated cases per function, seed 7, 200,000-instruction cap, O2 default and speed with chains, coalesce and homes. Execute the reference compiler on the same cases. Record caps and programs without an image separately.

Start with the regex gap. Rank surviving statements by dynamic instruction count and join them to D1's decision rows. Delta alone hides expensive code whose count stays constant. Inspect hot statement trees and instruction selections. A reference total establishes opportunity but cannot attribute a particular saving.

For a local algebraic identity use the rule library, its verifier and the existing simplify pass. For a pattern exposed by pass order, first try a single existing checked pass through the strategy. For an instruction-selection opportunity use an existing checked IR transformation if its result expresses the cheaper operation directly. Compare the candidate alone with baseline, keeping cases and backend fixed. Keep a change when measured savings justify its corpus costs. Report counterexamples and regressions.

Extend Typed attribution only where the evidence needs it. A separate profiler would duplicate the existing site measurement. No tensor work or general rule-search engine is needed for this experiment.

## Validation

Use repository rule verification for each new identity and the pipeline's normal meaning and correspondence checks. Build and run Typed, framework and workbench test files. Separate instruction counts from claims about all possible inputs.
