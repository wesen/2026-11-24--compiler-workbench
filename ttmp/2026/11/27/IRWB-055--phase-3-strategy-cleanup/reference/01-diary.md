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
