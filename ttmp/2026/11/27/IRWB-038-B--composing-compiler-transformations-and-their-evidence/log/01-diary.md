---
Title: Diary
Ticket: IRWB-038-B
Status: active
Topics:
    - compiler
    - research
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T12:55:25.705992437-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## 1. Fix the comparison boundary

I started at merged revision 93ec5fc. The review asks which repeated compiler mechanisms belong in the framework, what to keep, and how to migrate in independently testable steps. The requested deliverables are a ticket design, committed probes, a diary, and a final summary. I read the framework guides, coordinator report and backlog first. The historical design treats transformations, IR projections and measurements as separate levels. The current pass bridge raised a narrower question about how a native pass carries its gate. See src/framework/passes/bridge.ts:39 and src/tensor/contract.ts:125.

I compared each named sibling with t6-base and checked working-tree status separately. A clean committed diff alone misses work in D1-D, D1-C, A0-C and B1-D. The inventory will label working-copy evidence explicitly. All execution will use the review checkout or standalone, read-only input. No remote device measurements are needed to test a pass boundary.
