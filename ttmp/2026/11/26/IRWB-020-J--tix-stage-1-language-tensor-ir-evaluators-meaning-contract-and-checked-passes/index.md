---
Title: 'Tix stage 1: language, tensor IR, evaluators, meaning contract and checked passes'
Ticket: IRWB-020-J
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Exercise the v6 framework with a second domain and document the changes it actually needs.
LastUpdated: 2026-11-26T12:54:36.370263756-05:00
WhatFor: Entry point for the Tix stage-1 review and implementation.
WhenToUse: Start here to find the proposed framework delta, verification plan and diary.
---

# Tix stage 1: language, tensor IR, evaluators, meaning contract and checked passes

**Status: design ready for review; implementation has not started.** The deliverable is a CPU-executable
index language with checked `inline` and `split-sum` rewrites and six tensor corpus examples. The finding to
review first is the gap between the synchronous optimizer API and the framework's asynchronous pass runner.

- [Design and framework delta ledger](design-doc/01-design-tix-programs-and-checked-tensor-passes.md)
- [Diary, original request and reproduction of the numerical witness](reference/01-implementation-diary.md)
- [Tasks](tasks.md) · [Changelog](changelog.md)

Await the review in this session before changing framework or tensor code. CUDA and subsequent optimizations
are outside this ticket.
