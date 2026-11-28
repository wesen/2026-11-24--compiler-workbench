---
Title: Diary
Ticket: IRWB-051-C
Status: active
Topics:
    - framework
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T20:22:27.072081855-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: reading, two probes, the design

Read the brief's list: the design doc's Phase 3, the R3 synthesis (K1, K3, K5, the merged lifecycle,
`verification.md` line 53), `define-pass.ts`, `bridge.ts`, and `analyse` / `preserve` / `verifyTransformation` in
the manager.

What I found that shapes the design:

- `analyseInternal` is about 105 lines and awaits in three places: `definition.run`, `drain`, and
  `Promise.allSettled` in its `finally`. Everything else (key, cache lookup, dependency replay, the record) is
  synchronous code. `preserveInternal` has the same shape.
- Every Typed analysis ignores its context and returns a value. So "pure" can be defined operationally: `run`
  returns a non-promise and leaves nothing pending.
- `verifyTransformation` is a different size of problem: 13 awaits, nested conditions, invariants that may be
  asynchronous (Typed's meaning check hands cases to worker threads when an executor is installed).
- `licm` and `bce`, the brief's examples, both declare `preserves: []`. `strength` has needs and three
  preservation claims, so I port that one.

Probes (`scripts/01-…`, `scripts/02-…`, outputs beside them):

- A throw into a generator suspended in `try` runs its `finally`, through `yield*`. One `yield*` round trip costs
  about 0.2 µs.
- `gen.return()` runs `finally` blocks and skips `catch` blocks; a yield inside a `finally` is passed by calling
  `return()` again (2 calls in the probe). This is how the synchronous driver abandons a runner.
- Today, at r0: `strength` changes 3 corpus programs (chess-search, sha-chacha, strength), `licm` 12, `bce` 10.
  `applyNativePassSync(inline, attention)` with a trivial gate: 1.7 ms on this machine at this moment (other
  agents share it; the brief's figure is 0.6 ms).

`npm ci` was needed (the worktree had no `node_modules`).

Decision: one effect (a value that may be a promise), the manager's own functions as generators, the runner
delegating with `yield*`. Design committed before the prototype.
