---
Title: Deriving streaming attention by checked rewrites
Ticket: IRWB-021-G
Status: review
Topics:
    - compiler
    - ir
    - verification
    - research
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Research design for deriving, checking and benchmarking tiled streaming attention from Tix.
LastUpdated: 2026-11-26T12:47:51.355650228-05:00
WhatFor: Track the design review for IRWB-021-G.
WhenToUse: When looking for the design, diary, or ticket status.
---

# Deriving streaming attention by checked rewrites

Can IR Workbench derive streaming attention from ordinary Tix using locally checked rewrites? This ticket specifies the derivation, the distinction between real equivalence and f32 acceptance, and a falsifiable GB10 experiment. The design is ready for review; no implementation or benchmark was performed.

- [Research design](./design-doc/01-deriving-streaming-attention-by-checked-rewrites.md)
- [Diary](./reference/01-diary.md)
- [Tasks](./tasks.md)
- [Changelog](./changelog.md)
