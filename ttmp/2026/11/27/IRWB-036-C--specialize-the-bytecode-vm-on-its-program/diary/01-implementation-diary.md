---
Title: Implementation diary
Ticket: IRWB-036-C
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:44:03.150406976-05:00
WhatFor: ""
WhenToUse: ""
---

## 1. Design checkpoint

The request is the user-authored task in this conversation: specialize the bytecode VM on a constant buffer and known entry, measure the two fixtures, commit the design first, and maintain a ticket and diary. The original request is the authoritative verbatim text.

The VM holds two fixed programs in a shared buffer; the loop counter remains dynamic, so a finite straight-line trace cannot represent all calls. The design proposes residual states and generated-case contract restrictions. This is a hypothesis to test, not a measured result.
