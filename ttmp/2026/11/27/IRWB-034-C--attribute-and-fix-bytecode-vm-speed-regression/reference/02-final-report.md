---
Title: Final report
Ticket: IRWB-034-C
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:43:43.988897115-05:00
WhatFor: ""
WhenToUse: ""
---

# Final report

## Goal

<!-- What is the purpose of this reference document? -->

## Context

<!-- Provide background context needed to use this reference -->

## Quick Reference

<!-- Provide copy/paste-ready content, API contracts, or quick-look tables -->

## Usage Examples

<!-- Show how to use this reference in practice -->

## Related

<!-- Link to related documents or resources -->

## Preliminary findings (work in progress)

At `n=12, seed=8`, with `coalesce: true`, the baseline revision probe measured Fibonacci/checksum: r0 7,678/6,874; after the third changed revision (cfg) 6,688/5,968; after LICM 9,287/8,219; final speed 9,286/8,218. Thus the LICM revision added 2,599/2,251 instructions at this point. No inline or rotation changed this program in that run.

For Fibonacci, the backend labels 342 executed instructions as frame-array address materialization before LICM and 2,749 after it. The backend's `address` selector folds an `aaddr` directly into an sp-relative memory instruction; LICM hoists `aaddr` into locals, hiding that shape. Frame size changes from 32 to 80 bytes, saved registers from zero to ten; spills remain zero. The frame-array instruction increase is 2,407 of the 2,599 total increase. The remaining difference includes other instructions and save/restore; it is not a per-edit counterfactual attribution.

The callable attribution prototype credits each executed instruction once to the latest non-retained correspondence associated with its covered IR entities, or ingest/backend. On the original speed image it credits Fibonacci: ingest/backend 3,855, licm 3,407, subst 2,024; checksum: 3,543, 2,915, 1,760 respectively. These credits are ownership, not estimates of savings; later rewrites can claim instructions derived from earlier decisions. The revision comparison and backend labels establish the cost separately.

A candidate guard prevents LICM from hoisting frame addresses. The same probe measured final Fibonacci/checksum 6,688/5,968 after the guard. It is not yet validated against the full corpus, parity, or required test suites; the candidate must not be considered complete until those checks pass. No framework changes were made.
