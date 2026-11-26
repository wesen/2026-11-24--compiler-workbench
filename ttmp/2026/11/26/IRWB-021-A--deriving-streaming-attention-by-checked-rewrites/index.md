---
Title: Deriving streaming attention by checked rewrites
Ticket: IRWB-021-A
Status: complete
Topics:
    - compiler
    - ir
    - verification
    - performance
    - research
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Research design for deriving streaming single-head attention from Tix using checked local rewrites.
LastUpdated: 2026-11-26T12:46:46.390357858-05:00
WhatFor: ""
WhenToUse: ""
---

# Deriving streaming attention by checked rewrites

Can a compiler derive a one-pass attention kernel from the ordinary Tix program and check each rewrite locally? The design gives six real-algebra rules, an ordered f32 fold, and a GB10 experiment to decide whether the resulting kernel is accurate and fast enough.

- [Research design](design-doc/01-deriving-a-block-streaming-attention-fold.md)
- [Research diary and framework probes](reference/01-research-diary.md)
- [Tasks](tasks.md) and [changelog](changelog.md)
