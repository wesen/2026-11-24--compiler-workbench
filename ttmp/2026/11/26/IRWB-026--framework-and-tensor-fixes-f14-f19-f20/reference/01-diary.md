---
Title: Diary
Ticket: IRWB-026
Status: active
Topics: []
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T22:13:11.47058452-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## 1. Report optimization decisions

Node v24.18.0 and the initial `npm run build` worked. The first test fixture rejected during coverage screening and had no counterexample. The revised fixture supplies a covered origin and a current program whose split candidate disagrees with it.

Before the fix, `node --test tests/tensor/passes.test.mjs` reported 5 passes and 2 failures. The new regression's deep equality check found neither `changed` nor the counterexample reason (`at [0] expected 0.5052213072776794, got NaN, allowed 0.00001210442614555359`). The updated composition assertion also found no `changed: true`.
After the fix, the build and all 7 pass tests succeeded. Accepted steps use the native pass result. Rejected steps report the first counterexample, or the gate error when screening provides no counterexample.
