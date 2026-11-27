---
Title: Ordered term staging and fusion selection
Ticket: IRWB-030-B
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T01:22:48.520599249-05:00
WhatFor: ""
WhenToUse: ""
---

# Ordered term staging and fusion selection

## Domain and schedule

Accept the checked Tix core and stage 1 rewrites on stage 2's domain of finite inputs, consistent nonnegative extents, in-bounds reads and allocatable buffers. Keep the existing identity-prefix proof for each group. For a row scalar with one ordinary reduction axis and an arithmetic body, distribute term indices across the row's block, using the existing scalar expression writer. Put the rounded terms in an additional row buffer. After a block barrier, thread zero traverses that buffer in increasing order with the original initial value and fold. This also handles extent zero. Reuse the buffer between statements. The simpler serial fold remains appropriate for plain loads, where staging duplicates a copy. Row-vector contractions already use threads across output elements. Preserve the ordinary lowering for complex nested bounds.

## Selecting groups

Compare leaving a divided contraction in a block group with cutting the group at that contraction so it can use one thread per element. In particular, a final contraction reading a global matrix with division inside the sum and few output columns can underuse the block. Choose the cut from measurements on both attention placements. Measure row staging against the serial schedule for both layernorm placements. Prefer an IR rule over launch-time dispatch when it distinguishes these cases. No timing probes in generated programs. One measured rule cannot guarantee speed on every possible shape.

## Verification

Compare the existing stage 2 source digests and run the exact GPU contract. Measure the eight specified workloads with three benchmark calls per mode to expose the stated run-to-run noise. Compare output digests as well as medians. A tree fold would change rounding and is outside scope. Keep the framework transformation, correspondence and runner unless a concrete missing capability emerges.
