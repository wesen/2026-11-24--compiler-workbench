---
Title: Tix language, tensor IR, evaluators, meaning contract and checked passes
Ticket: IRWB-020-L
Status: complete
Topics:
    - compiler
    - ir
    - verification
    - typescript
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T14:52:15.571941128-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix language, tensor IR, evaluators, meaning contract and checked passes

IRWB-020-L takes the IR Workbench framework through a second domain. Stage 1 covers the Tix frontend, the v6 tensor artifact, f32 and f64 evaluation, the differential contract, and two checked passes.

- [Stage 1 design](design-doc/01-stage-1-design-for-tix-tensor-programs.md)
- [Final report](reference/02-report.md)
- [Diary](reference/01-diary.md)
- [Tasks](tasks.md)
- [Changelog](changelog.md)

The reviewed Stage 1 implementation exports the synchronous Tix API from `dist/tensor/index.js` after the build. The six corpus programs live under `corpus/tensor/`. The diary records the generated-case contract checks and the framework and Typed regressions.
