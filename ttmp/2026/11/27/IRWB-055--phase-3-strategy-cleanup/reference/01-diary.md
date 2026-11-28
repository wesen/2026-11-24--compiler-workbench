---
Title: Diary
Ticket: IRWB-055
Status: active
Topics: [framework]
DocType: reference
---

# Diary

## 1. Cleanup

The requested scope is the steps module move, a shared identity algorithm, and a shared pass-sequence builder. The Typed builder must preserve selective `tolerate` behavior, while Tix tolerates each pass. The builder retains existing node IDs for execution records.

Moved the generic drivers to core, replaced the duplicate identity implementations and plan construction, and added `core/steps.js` to the layering allow-list. `npm run check` and `npm run build` passed. Baseline, suite and site checks are in progress.

Git could not create its index lock in the sandbox (read-only filesystem); commit needs elevated access.

## 2. Verification

At implementation commit `25acb27`, `npm run check`, `npm run build`, and `node tools/build-site.mjs` passed. The coordinator baseline check printed `no differences` (inline on attention 0.562 -> 1.532 ms/application; timing is informational).

The requested combined suite initially reported 74 passing and 4 failing test files in the sandbox; its file-level output did not expose the underlying diagnostics. Reran those four files with escalation, as directed for tests that spawn Node: 15 tests passed, 1 skipped, 0 failed. No assertions were changed. The final report records this distinction; no baseline was rewritten.
