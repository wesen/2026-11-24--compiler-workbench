---
Title: Checked lowering of Tix to CUDA on the GPU machine
Ticket: IRWB-022-L
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
Summary: Design and GB10 evidence for a checked Tix-to-CUDA backend.
LastUpdated: 2026-11-26T16:37:37.945044585-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked lowering of Tix to CUDA on the GPU machine

The CUDA backend emits directly from Tix, batches correctness checks on the GB10 and compares each result with the original program's f64 evaluation.

- [Design and change ledger](design-doc/01-checking-tix-cuda-lowering-on-the-gb10.md)
- [Implementation results and corpus timings](reference/02-cuda-lowering-results-and-corpus-timings.md)
- [Diary and probe reproduction commands](reference/01-design-and-implementation-diary.md)
- [GB10 measurements and first differing words](scripts/04-probe-result.json)
- [Tasks](tasks.md) · [Changelog](changelog.md)

Stage 1 supplies the input semantics and the tolerance budget. [Stage-1 design](../IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-tix-semantics-and-checked-tensor-rewrites.md) · [Stage-1 report](../IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/02-report.md)
