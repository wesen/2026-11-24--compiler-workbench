---
Title: Tix language, tensor IR, evaluators, meaning contract and checked passes
Ticket: IRWB-020-I
Status: review
Topics:
    - compiler
    - ir
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Design review for the Tix tensor domain and the framework changes needed by checked native rewrites.
LastUpdated: 2026-11-26T13:02:49.540312856-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix language, tensor IR, evaluators, meaning contract and checked passes

The second compiler domain will test how far the v6 framework can carry a tensor program from checked source to a checked rewrite. The stage 1 design is ready for review. The proposed framework changes concern synchronous native pass execution and the graph editor requirement.

- [Design and framework change ledger](design-doc/01-tix-semantics-tensor-ir-and-checked-rewrites.md)
- [Diary and probe results](reference/01-diary.md)
- [Tasks](tasks.md)
- [Changelog](changelog.md)
