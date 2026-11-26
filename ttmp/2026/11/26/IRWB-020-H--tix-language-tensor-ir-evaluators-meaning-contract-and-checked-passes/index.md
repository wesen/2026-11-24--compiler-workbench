---
Title: Tix language, tensor IR, evaluators, meaning contract and checked passes
Ticket: IRWB-020-H
Status: complete
Topics:
    - compiler
    - ir
    - verification
DocType: index
Intent: short-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Stage 1 of the tensor domain, using Tix to test the reusable IR framework.
LastUpdated: 2026-11-26T14:06:03.601750572-05:00
WhatFor: Stage scope, design review and implementation tracking
WhenToUse: Start here for IRWB-020-H
---

# Tix language, tensor IR, evaluators, meaning contract and checked passes

**Stage 1 implemented and checked.** `src/tensor/` implements Tix, both CPU evaluators and the two checked passes. `corpus/tensor/` contains six executable source fixtures. The only framework change was extracting synchronous native-candidate preparation. GPU work is outside this ticket.

- [Stage 1 report](reference/02-report.md) — results and the cause of the program 39 rejection.
- [Design and framework change ledger](design-doc/01-stage-1-design-checking-tix-tensor-transformations.md) — reviewed plan and actual framework change.
- [Diary](reference/01-diary.md) — request, investigation and arithmetic probe.
- [Tasks](tasks.md) · [Changelog](changelog.md)
