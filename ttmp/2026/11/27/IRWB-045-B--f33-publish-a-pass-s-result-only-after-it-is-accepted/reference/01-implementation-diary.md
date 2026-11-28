---
Title: 'IRWB-045-B implementation diary'
Ticket: IRWB-045-B
Status: active
Topics:
    - framework
    - passes
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: 'Chronological record of the F33 acceptance-boundary change.'
LastUpdated: 2026-11-27
WhatFor: 'Evidence trail for the F33 fix: what was probed, decided, changed, and verified.'
WhenToUse: 'Resume context for IRWB-045-B or follow-up steps on publication atomicity.'
---

# IRWB-045-B diary

## Step 1: read the defect, design the boundary (commit 89103af)

Read `define-pass.ts` (`prepareNative` :223, `applyPass` :345–389), `ir/view.ts` (`openIR` :190),
`ir/store.ts` (`retain`, no rollback path) and `contracts/analysis-manager.ts`
(`beginTransformation`'s overlay, `verifyTransformation`'s `deferCommit`, `discard()`'s tombstone
idiom, `invalidate`). Key findings:

- the candidate is retained into the caller's store by `openIR` inside `prepareNative`; a caller
  store plus a same-id changed revision even throws `ir.unpublished` there today — no production
  caller passes `store` to `applyPass` (only the tests; `bridge.ts`'s option is never supplied);
- the manager already has the private path (`deferCommit: true` returns a prepared result with
  `commit`/`rollback`), but the preservation checks themselves publish: a successful transfer
  writes an analysis record about the candidate, and the recompute fallback runs
  `manager.analyse(def, after)` — both name the rejected candidate as subject;
- the manager's own rollback idiom is tombstones: `discard()` copies overlay history records into
  the real history marked `valid: false, invalidation: 'Discarded provisional transaction'`.

Decisions (with alternatives) recorded in the design doc; the notable one: reject building a new
public provisional-scope concept in the manager for this step (a scope frame must pre-declare the
effects of every transitively used analysis, `effectAllowed` walks the parent chain), and instead
invalidate the candidate's preservation evidence on rejection — same tombstone shape the manager
already produces.

## Step 2: implement (commit d663826)

- `prepareNative` drops its `store` parameter: the candidate opens on a private throwaway store.
- `applyPass`: the contract runs with `{ deferCommit: true }`; the preservation loop and the commit
  are wrapped in one boundary — on any failure every preserved definition is invalidated for the
  candidate and the prepared contract is rolled back; on success `prepared.commit()` runs first
  and only then `store.retain(after)` (native results only; the edit path never retained at all,
  and must keep not retaining).
- Removed `todo: 'F33'` from both tests in `tests/framework/r3-defects.test.mjs`.

First run of `r3-defects.test.mjs` after the code change: both F33 tests green while still todo —
the signal to remove the todo in the same commit. Reformatting the de-todo'd second test left the
body indented for the multi-line form; fixed with a small python dedent (not committed as a probe
since it is a one-shot file edit).

## Step 3: verify

- `node --test tests/framework/r3-defects.test.mjs`: F33 tests pass as real tests (F34/F35 still
  todo, as other steps own them).
- Baselines (`IRWB-039/scripts/02-baselines.mjs check`): `no differences`.
- Suites: framework 21 files, typed 35, workbench 5, tensor 6 (gpu excluded) — all green apart from
  the other steps' todos (F34, F35, the three D2 tests, the r3-tix-in-plans test) and pre-existing
  env-gated `skip`s (IRWB_CANDELA / IRWB_FULL).
- `npm run check` clean; `node tools/build-site.mjs` builds (framework changed).
- `scripts/01-acceptance-boundary.mjs` (the R3 probe 03 scenarios plus an accepted-with-store
  control): rejection leaves no store head; `preserveViolated` leaves execution `rolled-back`, no
  valid fact about the candidate (the recompute records survive as `valid=false` tombstones);
  an accepted application still publishes the accepted revision to the caller's store.

Nothing surprising failed. The one measurement worth recording: the deferred commit moves the
contract's execution status to `accepted` only after preservation; the last execution a rejected
application leaves is `rolled-back`, which is what the second F33 test asserts.
