---
Title: Final report
Ticket: IRWB-042-A
Status: active
Topics:
    - typed
    - compiler
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/passes.ts
      Note: Pass fixes
    - Path: repo://tests/typed/d2-defects.test.mjs
      Note: Regression tests
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T17:27:49.96835755-05:00
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

## Changes

BCE compares SSA names for the index and buffer reads at the guard and the bounds check. LVN removes cached candidates whose values no longer occur in their original statement after a replacement. The F36 and F38 tests are active.

## Verification

- `npm run build` and `npm run check`: passed.
- `node --test tests/typed/d2-defects.test.mjs`: F36 and F38 pass; F37 is the pre-existing todo (2 pass, 0 fail, 1 todo).
- The corpus baseline comparison printed `no differences`; no project differences or instruction increases to explain.
- No framework or workbench files changed, so the site build was not required.

F37 is outside this ticket. No requested assertion was weakened.
- `node --test --test-concurrency=2` over all requested test files excluding `*-gpu.test.mjs`: 500 tests, 491 pass, 0 fail, 3 skipped, 6 todo. Exit 0.
- Post-build baseline rerun: `no differences` (exit 0).
