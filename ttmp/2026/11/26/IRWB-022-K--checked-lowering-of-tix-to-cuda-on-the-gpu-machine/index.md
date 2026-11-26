---
Title: Checked lowering of Tix to CUDA on the GPU machine
Ticket: IRWB-022-K
Status: review
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
LastUpdated: 2026-11-26T15:18:22.22324522-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked lowering of Tix to CUDA on the GPU machine

**Design ready for review.** Lower each statement of a stage-1 Tix function to one CUDA kernel and check the resulting translation unit on the GB10. A device probe found one-bit differences from the f32 interpreter for exp, log and tanh. The proposed contract compares sampled GPU outputs with the original program's f64 result.

- [Design, probe results and proposed framework and runner changes](design-doc/01-checked-cuda-lowering-for-tix.md)
- [Diary and commands to reproduce the probes](reference/01-design-and-implementation-diary.md)
- [Stage-1 final report](../IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/02-report.md)
- [Tasks](tasks.md) and [changelog](changelog.md)
