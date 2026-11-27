---
Title: Implementation diary
Ticket: IRWB-030-B
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T01:22:48.745655008-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1. Choose the scheduling boundary

The request says “Compute a reduction's terms in parallel and accumulate them in order.” The existing kernel writer already emits each rounding operation, and the plan establishes row ownership. The design puts the new scheduling decision between them. Group cuts must occur before computing live outputs, so that a later kernel can read every value it needs.

Read the two preceding designs and reports, checked the planner, CUDA writer, transformation and relevant framework interfaces. Node reported v24.18.0 and npm ci --offline restored all six build dependencies. Review the design against the two division placements before interpreting the timing results.
