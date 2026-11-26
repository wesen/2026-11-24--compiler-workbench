---
Title: Checked lowering of Tix to CUDA on the GPU machine
Ticket: IRWB-022-K
Status: complete
Topics:
    - compiler
    - ir
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T16:10:16.643399573-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked lowering of Tix to CUDA on the GPU machine

Tix lowers each statement to one CUDA kernel and checks the emitted translation unit on the GB10. The contract batches origin-derived cases, compares GPU results with stage-1 f64, and reuses evidence for the same source and engine profile.

- [Implementation results, validation and six-program timing table](reference/02-cuda-lowering-results-and-framework-findings.md)
- [Design, probe results and proposed framework and runner changes](design-doc/01-checked-cuda-lowering-for-tix.md)
- [Diary and commands to reproduce the probes](reference/01-design-and-implementation-diary.md)
- [Stage-1 final report](../IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/02-report.md)
- [Tasks](tasks.md) and [changelog](changelog.md)
