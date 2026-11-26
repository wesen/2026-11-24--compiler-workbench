---
Title: Tix language, tensor IR, evaluators, meaning contract and checked passes
Ticket: IRWB-020-D
Status: complete
Topics:
    - ir
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Implemented and tested Tix stage 1 on the v6 IR framework.
LastUpdated: 2026-11-26T14:49:40.376155633-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix language, tensor IR, evaluators, meaning contract and checked passes

The [final report](./reference/02-report.md) describes the implemented compiler, the framework change, and the independent evaluation of revision `216faa0`.

The [stage-1 design](./design-doc/01-stage-1-design-for-the-tix-tensor-domain.md) records the implemented language, tensor IR, precision rules and sampled pass contract. The framework now runs synchronous native passes using the existing pass declaration, diff, correspondence and declared writes.

The [diary](./reference/01-design-and-implementation-diary.md) contains the review decisions, numeric measurements and regression results. See the [tasks](./tasks.md) and [changelog](./changelog.md).
