---
Title: Tix language, tensor IR, evaluators, meaning contract and checked passes
Ticket: IRWB-020-D
Status: review
Topics:
    - ir
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Design review for the first tensor stage of the IR Workbench.
LastUpdated: 2026-11-26T12:39:26.440328739-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix language, tensor IR, evaluators, meaning contract and checked passes

The [stage-1 design](./design-doc/01-stage-1-design-for-the-tix-tensor-domain.md) is ready for review. It proposes a checked tensor IR, two evaluators and two passes that distinguish bitwise f32 preservation from acceptable reassociation. The principal framework decision is how to run a checked native pass through a synchronous public API.

The [diary](./reference/01-design-and-implementation-diary.md) records the baseline framework probe and the one-bit reduction witness. Implementation follows the design review. See the [tasks](./tasks.md) and [changelog](./changelog.md).
