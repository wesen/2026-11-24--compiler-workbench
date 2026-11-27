---
Title: Diary
Ticket: IRWB-028
Status: active
Topics:
    - typed
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T22:56:51.278993322-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

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

## F2

Required the existing signatures argument: smaller than changing the reference compiler result API. Regression `node --test --test-name-pattern='reference images require signatures' tests/typed/f32-backend.test.mjs` failed before the fix with `Missing expected exception`, then passed after build. The first attempt lacked dist; a sandboxed runner also failed at file level, so the successful runs used escalation.

## F3

`node --test tests/typed/reference-check.test.mjs` failed with 83 functions instead of blend's one. Selecting and validating requested ids makes it pass; no ids still selects the corpus.

## F4

The already-wrapped list regression in `tests/typed/format.test.mjs` failed because continuation lines lost their spaces. Preserving their existing indent when wrapping makes it pass and preserves idempotence.

## F5

Changed corpus checks in backend, passes, SSA and tape tests to check per-project correctness and case accounting. The changed tests passed on the corpus (5/5) and with a temporary blend copy (4/4), removed by `scripts/01-extra-project.sh`. Size totals now check nonempty images per project; their former fixed totals described a particular corpus snapshot.
