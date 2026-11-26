---
Title: Deriving streaming attention by checked rewrites
Ticket: IRWB-021-F
Status: complete
Topics: [compiler, research, verification]
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Research design for a checked derivation and GB10 comparison of streaming attention.
LastUpdated: 2026-11-26
WhatFor: Review the proposed rewrite chain and its acceptance criteria.
WhenToUse: When planning an experiment on Tix reduction fusion.
---

# Deriving streaming attention by checked rewrites

Can a compiler eliminate the quadratic intermediates of single-head attention without knowing attention by name? The [design](design-doc/01-from-stable-softmax-to-a-block-summary.md) derives a block summary from the source's two weighted sums. It separates three questions: whether each rewrite preserves real values, whether the resulting f32 program meets a tolerance contract, and whether eliminating the intermediate tensors actually improves GB10 time and traffic.

Design only; numerical and performance results are not yet available. See the [research diary](reference/01-research-diary.md) for the request and review notes, [tasks](tasks.md) and [changelog](changelog.md) for ticket history.
