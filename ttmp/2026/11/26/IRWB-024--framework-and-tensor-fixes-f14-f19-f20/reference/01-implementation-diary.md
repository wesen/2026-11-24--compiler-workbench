---
Title: Implementation diary
Ticket: IRWB-024
Status: active
Topics:
    - tensor
    - verification
    - gpu
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/index.ts
      Note: Optimization step reporting
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T22:07:05.36779357-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## 1. Report what happened to the Tix revision

After `npm run build` on Node 24.18.0, `node --test tests/tensor/passes.test.mjs` passed 4 and failed 3 on the original implementation. Both split steps were accepted, but neither reported whether it changed the revision. The composed inline step also omitted `changed`. The rejected split returned only its name and acceptance flag. Its first counterexample said `at [0] expected 0.5052213072776794, got 0, allowed 0.00001210442614555359`.

Forwarded the native pass result's `changed` flag. A rejection keeps the current revision and uses the first counterexample reason, with the contract diagnostic as the fallback for a gate such as coverage. After rebuilding, all 7 tensor pass tests passed.
