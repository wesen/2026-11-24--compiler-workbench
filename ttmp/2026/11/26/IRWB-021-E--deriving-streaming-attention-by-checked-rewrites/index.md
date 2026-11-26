---
Title: Deriving streaming attention by checked rewrites
Ticket: IRWB-021-E
Status: review
Topics: [research, compiler, verification, performance]
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Research design for deriving attention without a global score matrix.
LastUpdated: 2026-11-26T12:47:56-05:00
WhatFor: Locate the derivation and its proposed acceptance test.
WhenToUse: When reviewing checked tensor rewrites.
---

# Deriving streaming attention by checked rewrites

Can a compiler discover the state shared by a row maximum, softmax denominator and weighted contraction? The [design](design-doc/01-from-row-softmax-to-a-checked-block-fold.md) derives a merge from a change of exponential origin. It specifies which operations retain f32 meaning exactly and how to test the rest against the original program. The proposed GB10 comparison is not a benchmark result.

Design ready for review. See the [diary](reference/01-research-diary.md), [task](tasks.md) and [changelog](changelog.md).
