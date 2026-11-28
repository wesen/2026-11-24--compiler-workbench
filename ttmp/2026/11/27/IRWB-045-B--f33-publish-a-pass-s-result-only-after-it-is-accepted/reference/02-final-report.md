---
Title: 'IRWB-045-B final report: one acceptance boundary for a pass application'
Ticket: IRWB-045-B
Status: active
Topics:
    - framework
    - passes
DocType: report
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: 'What F33 changed, what a rejection leaves behind, acceptance results, and what is left out.'
LastUpdated: 2026-11-27
WhatFor: 'The closing record of the F33 step: evidence, decisions, and verification results.'
WhenToUse: 'Review of IRWB-045-B; input to the IRWB-039 v7 refactor tracking.'
---

# IRWB-045-B final report: publish a pass's result only after it is accepted

## What changed

One acceptance boundary in `applyPass` (`src/framework/passes/define-pass.ts`), in two halves:

1. **The store.** `prepareNative` no longer opens the candidate on the caller's `IRStore`; it opens
   it on a private throwaway store. After all checks pass, `applyPass` publishes by
   `store.retain(after)` — the exact publication `openIR` performed before, moved behind the
   boundary, and only for native results (the edit path never retained its revision, and still
   does not).
2. **The manager.** The contract runs through `manager.verifyTransformation(..., { deferCommit: true })`;
   the preservation checks and `prepared.commit()` share one try/catch. On any rejection the
   prepared contract is rolled back (its overlay facts are discarded the way the manager's own
   `discard()` already treats provisional transactions) and every preservation record naming the
   candidate is invalidated, so no *valid* fact about a rejected candidate survives. Accepted
   applications keep their current results: same `PassResult`, same `contract` object (committed),
   and the candidate still becomes the caller's store head.

`applyNativePassSync` already had no manager and opened its candidate on a private store; it keeps
its results unchanged (only the shared `prepareNative` signature changed).

## What a rejection leaves behind

Analyses about the *input* (needs, preservation sources — the input was already accepted);
invalidated tombstones for the candidate's preservation evidence; events; and the contract
execution with status `rejected` or `rolled-back`, never `accepted`. No store head, no valid fact.

## Acceptance results (last commit)

- **Tests:** `F33: a candidate the contract rejects does not become a store head` and
  `F33: no accepted execution or fact survives a later preservation failure` pass with their
  `todo` options removed (`tests/framework/r3-defects.test.mjs`: tests 4, pass 2, todo 2 — the two
  remaining are F34's and F35's, owned by other steps).
- **Baselines:** `02-baselines.mjs check` prints `no differences` (RV32 image hashes, instruction
  counts, edit records, CUDA source, `optimizeTix` revisions unchanged).
- **Suites** (gpu files excluded): framework 21 files / 242 tests, typed 34 files / 173 tests,
  workbench 5 files / 25 tests, tensor 7 files / 45 tests — 0 failures; only the other steps'
  todo tests and pre-existing env-gated skips (`IRWB_CANDELA`, `IRWB_FULL`) do not pass.
- `npm run check` (tsc `--noEmit`) is clean; `node tools/build-site.mjs` builds (framework changed).
- `scripts/01-acceptance-boundary.mjs` (R3 probe 03 scenarios + an accepted-with-store control)
  shows both rejections publishing nothing and the accepted application still publishing.

## Left out / caveats

- **A public provisional scope in the manager** (so preservation evidence about a candidate is never
  even temporarily visible, and the tombstone cleanup is unnecessary): rejected for this step
  because a scope frame must pre-declare the effects of every transitively used analysis
  (`effectAllowed` walks the parent chain), which would change permission semantics for the
  analyses run under it. Recorded under "Later" in the design.
- **Store protocol edge:** for (caller store) × (same artifact id) × (changed revision),
  `retain` now throws `ir.unpublished` *after* the checks instead of before them, and a contract
  rejection now wins. No current caller uses that combination (the only store-passing `applyPass`
  caller is the test; `bridge.ts`'s `store` option is never supplied).
- The boundary assumes the pass's contract does not depend on a fact the preservation loop
  recomputes to a new generation; if it ever does, `commit` fails closed (`stale-evidence`,
  nothing published). With the corpus passes this cannot arise (the typed meaning contract reads
  no analyses; the preserved dataflow facts are cacheable).

## Commits

- `89103af` IRWB-045-B: design — one acceptance boundary for a pass application (F33)
- `d663826` IRWB-045-B: F33 — one acceptance boundary in applyPass: private candidate store,
  deferred contract commit, nothing published on rejection
