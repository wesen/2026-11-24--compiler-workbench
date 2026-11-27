---
Title: Ordered parallel terms for Tix fusion
Ticket: IRWB-030-B
Status: complete
Topics:
    - tensor
    - gpu
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-source.ts
      Note: Shared term buffer and ordered fold
    - Path: repo://src/tensor/fusion.ts
      Note: IR legality and schedule selection
    - Path: repo://tests/tensor/fusion-gpu.test.mjs
      Note: Exact stage and fallback regressions
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T01:37:22.714051485-05:00
WhatFor: ""
WhenToUse: ""
---

# Ordered parallel terms for Tix fusion

The ticket implements exact ordered term staging for costly row reductions and an IR-based group cut for divided contractions. All results use the GB10 and the public lowering API.

- [Design](design-doc/01-ordered-term-staging-and-fusion-selection.md)
- [GB10 results and framework findings](reference/02-gb10-results-for-ordered-term-staging-and-fusion-cuts.md)
- [Implementation diary](reference/01-implementation-diary.md)
- [Replay and raw measurements](scripts/)
