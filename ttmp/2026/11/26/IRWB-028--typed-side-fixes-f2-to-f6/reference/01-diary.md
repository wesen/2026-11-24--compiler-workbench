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

F2 follow-up: the broad run found chess's fixture still omitted signatures, causing four setup failures reading `filter` of undefined. Updated that caller too.

## F6

The corpus-wide workbench metadata regression initially failed with `parseProjectMeta is not a function`. Extracted the existing Typed metadata parser and reused it in the workbench, retaining its defaults and malformed-JSON fallback; the regression passes for every corpus project.

Final validation: `npm run build` passed; `node --test tests/typed/*.test.mjs tests/workbench/*.test.mjs` passed 173 of 176 tests, with 3 skipped. Prettier was unavailable in this worktree; changed TypeScript follows the existing formatting manually.

## F5 review follow-up

The prior F5 replaced regression quantities with nonzero checks; the review correctly identified that as a loss of coverage. Measured every project through the existing test paths with `scripts/02-measure.mjs` and recorded the values in a shared per-project table. Each affected test now checks its own functions, cases, sizes, SSA gets or tape classification against that row. The backend also checks that the corpus and table contain the same projects.

Chapter 13 was present at revision `ea1d742`; its tree contains 44 projects. `scripts/03-expectations.mjs` measured precisely 70 reference functions, 6,986 decided and 14 inconclusive cases, and 5,160/7,628 image bytes for that set; pipeline parity is 7,000 total, 6,986 agreed and 14 inconclusive. The tests preserve those figures for the historical set separately from current per-project checks.

`scripts/04-extra-project.mjs` copied Blend, verified the missing-row error, added one copied row, and ran all affected tests in full mode: 6 passed. It restored the table and removed the project. `npm run build` passed, and the Typed/workbench suite reported 176 tests: 173 passed, 3 skipped, 0 failed. After adding project-set coverage the targeted backend test and the six full temporary-project checks passed again.
