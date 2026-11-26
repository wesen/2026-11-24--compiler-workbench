---
Title: Lowering Tix to CUDA with checked execution on the GPU machine
Ticket: IRWB-022-I
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Stage 2 design and GPU evidence for a checked Tix to CUDA lowering.
LastUpdated: 2026-11-26T15:11:45.471966399-05:00
WhatFor: ""
WhenToUse: ""
---

# Lowering Tix to CUDA with checked execution on the GPU machine

Stage 2 lowers the current Tix function to one CUDA kernel per statement and uses the GB10 to check its output against the Stage 1 f64 evaluator. The reviewed lowering is implemented, tested and measured on the six corpus workloads.

- [Design](design-doc/01-checked-tix-to-cuda-lowering.md)
- [Verification and corpus timings](reference/02-cuda-lowering-verification-and-corpus-timings.md)
- [Diary and probe evidence](reference/01-implementation-diary.md)
- [Tasks](tasks.md)
- [Changelog](changelog.md)
