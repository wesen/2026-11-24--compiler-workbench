---
Title: Deriving streaming attention by checked rewrites
Ticket: IRWB-021-L
Status: complete
Topics:
    - compiler
    - ir
    - verification
    - research
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Research design for deriving a block-streaming attention kernel without an attention-specific substitution.
LastUpdated: 2026-11-26T13:01:44.64988354-05:00
WhatFor: Identify the design, evidence and scope of IRWB-021-L.
WhenToUse: Reviewing the Tix-to-CUDA attention research question.
---

# Deriving streaming attention by checked rewrites

Can a compiler turn the plain Tix reductions into one pass over key blocks, with a check at every edit? The [design](design-doc/01-from-dense-softmax-to-a-checked-block-fold.md) gives the local laws, the ordered tuple fold they produce, and an experiment that could reject either the numerical or performance claim. It distinguishes eliminating a quadratic intermediate from reducing measured GB10 memory traffic.

The deliverable is the design only. No change to Tix or the framework, kernel implementation or GPU result is claimed.

- [Research diary](reference/01-research-diary.md)
- [Tasks](tasks.md) · [Changelog](changelog.md)
