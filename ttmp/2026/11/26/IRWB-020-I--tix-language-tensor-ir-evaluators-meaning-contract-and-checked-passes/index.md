---
Title: Tix language, tensor IR, evaluators, meaning contract and checked passes
Ticket: IRWB-020-I
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
Summary: Completed Tix tensor domain, numerical meaning contracts, two checked passes and six verified corpus programs.
LastUpdated: 2026-11-26T14:50:39.555129014-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix language, tensor IR, evaluators, meaning contract and checked passes

Stage 1 implements Tix as the second compiler domain. Six corpus programs exercise f32/f64 execution and checked rewrites. The framework change is confined to the shared pass runner. The design contains the change ledger, and the diary records the regression results.

- [Design and framework change ledger](design-doc/01-tix-semantics-tensor-ir-and-checked-rewrites.md)
- [Diary and probe results](reference/01-diary.md)
- [Tasks](tasks.md)
- [Changelog](changelog.md)
