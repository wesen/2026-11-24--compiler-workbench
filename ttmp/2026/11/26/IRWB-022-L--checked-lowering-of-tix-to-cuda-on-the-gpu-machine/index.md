---
Title: Checked lowering of Tix to CUDA on the GPU machine
Ticket: IRWB-022-L
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
Summary: Design and GB10 evidence for a checked Tix-to-CUDA backend.
LastUpdated: 2026-11-26T15:20:54.486417542-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked lowering of Tix to CUDA on the GPU machine

**Design ready for review.** The proposal emits CUDA directly from Tix, batches correctness checks on the GB10 and compares the result with the original program's f64 evaluation. The design includes the device evidence, the framework and runner decisions, and the six-program measurement protocol.

- [Design and change ledger](design-doc/01-checking-tix-cuda-lowering-on-the-gb10.md)
- [Diary and probe reproduction commands](reference/01-design-and-implementation-diary.md)
- [GB10 measurements and first differing words](scripts/04-probe-result.json)
- [Tasks](tasks.md) · [Changelog](changelog.md)

Stage 1 supplies the input semantics and the tolerance budget. [Stage-1 design](../IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-tix-semantics-and-checked-tensor-rewrites.md) · [Stage-1 report](../IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/02-report.md)
