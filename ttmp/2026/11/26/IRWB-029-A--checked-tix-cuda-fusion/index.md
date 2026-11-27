---
Title: Checked Tix CUDA fusion
Ticket: IRWB-029-A
Status: complete
Topics:
    - compiler
    - ir
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Exact GPU acceptance for both schedule modes
    - Path: repo://src/tensor/cuda-fusion.ts
      Note: Legality and kernel grouping
    - Path: repo://src/tensor/cuda-source.ts
      Note: CUDA thread mappings, barriers and storage
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T23:15:45.673320053-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked Tix CUDA fusion

Stage 3 of Tix adds checked CUDA fusion from resolved tensor definitions. The workbench retains the per-statement lowering for comparison.

- [Design](design-doc/01-order-preserving-cuda-fusion.md)
- [Results](reference/02-checked-fusion-results.md)
- [Implementation diary](reference/01-implementation-diary.md)
- [Tasks](tasks.md)
- [Changelog](changelog.md)
