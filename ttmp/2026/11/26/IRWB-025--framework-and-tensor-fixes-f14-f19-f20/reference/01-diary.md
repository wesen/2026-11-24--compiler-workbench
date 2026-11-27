---
Title: Diary
Ticket: IRWB-025
Status: active
Topics:
    - framework
    - tensor
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T22:10:53.910649311-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## 1. Tix pass reporting

On Node 24.18.0, the baseline build passed. Before the fix, `node --test tests/tensor/passes.test.mjs` failed two whole-step comparisons. Both lacked `changed`, and the rejected split lacked the coverage reason, “No comparable case for g”. The native pass already returns the change flag and its rejection message already carries the gate's reason.
Coverage rejection has no differential evidence. Exposing the raw gate reason on PassError handles both the coverage diagnostic and the first counterexample without parsing the formatted message.

## 2. Concurrent differential checks

Before the fix, `node --test tests/tensor/cuda.test.mjs` reported two batches where concurrent cold callers expected one. The regression also checks both callers see the transport failure and a later check retries successfully.

## 3. Remote linking

Before the fix, `node --test --test-name-pattern='remote runner' tests/tensor/cuda-gpu.test.mjs` failed because adding both libraries produced the same build hash as the unlinked invocation.

The untimed probe ran with `node tools/cuda-remote.mjs <ticket>/scripts/01-cublas --link cublas`. On manuel@bling it compiled, exited 0 and matched the CPU product exactly, [[19,22],[43,50]].
The final build passed. All 258 framework and tensor tests passed, including the GB10 tests, with zero failures or skips.
