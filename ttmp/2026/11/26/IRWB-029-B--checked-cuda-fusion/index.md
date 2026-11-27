---
Title: Checked CUDA fusion
Ticket: IRWB-029-B
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
LastUpdated: 2026-11-26T23:11:13.816713198-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked CUDA fusion

The CUDA emitter groups Tix definitions that can share a thread or a row-owning block while preserving the current revision's f32 order. The exact checker accepted both modes on the corpus, and all six full-size fused outputs matched their unfused hashes.

- [Design committed before implementation](design-doc/01-order-preserving-fusion.md)
- [Results, per-kernel traffic and framework findings](reference/02-fusion-results.md)
- [Implementation diary](reference/01-implementation-diary.md)
