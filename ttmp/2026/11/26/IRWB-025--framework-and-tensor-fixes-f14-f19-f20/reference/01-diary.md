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

On Node 24.18.0, the baseline build passed. Before the fix, `node --test tests/tensor/passes.test.mjs` failed two whole-step comparisons. Both lacked `changed`, and the rejected split lacked the first counterexample, “No comparable case for g”. The native pass already returns the change flag and its rejection message already carries the gate's reason.
Coverage rejection has no differential evidence. Exposing the raw gate reason on PassError handles both the coverage diagnostic and the first counterexample without parsing the formatted message.

