---
Title: Deriving streaming attention by checked rewrites
Ticket: IRWB-021-J
Status: complete
Topics:
    - research
    - compiler
    - ir
    - verification
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Research design for deriving block-streaming attention from Tix using six locally checked rewrites.
LastUpdated: 2026-11-26T13:02:56.153027551-05:00
WhatFor: ""
WhenToUse: ""
---

# Deriving streaming attention by checked rewrites

**IRWB-021-J** asks whether a compiler can turn plain Tix attention into a single pass over blocks of keys, with a mechanical check after every rewrite. The design derives the running state, specifies the f32 contract and sets the conditions for a GB10 experiment.

- [Research design](design-doc/01-from-materialized-scores-to-a-checked-streaming-fold.md) — six rewrite schemas, their worked derivation, and the three-way hardware comparison.
- [Research diary](reference/01-research-diary.md) — framework probes, numerical counterexamples and review notes.
- [Tasks](tasks.md) and [changelog](changelog.md).
