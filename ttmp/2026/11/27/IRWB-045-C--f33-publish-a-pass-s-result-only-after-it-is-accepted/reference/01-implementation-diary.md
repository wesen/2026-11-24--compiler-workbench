---
Title: Implementation diary
Ticket: IRWB-045-C
Status: active
Topics:
    - framework
    - verification
    - refactor
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - src/framework/ir/store.ts
    - src/framework/passes/define-pass.ts
    - tests/framework/r3-defects.test.mjs
ExternalSources: []
Summary: "Chronological record of F33: probe, design, store publication, deferred contract, tests, baselines."
LastUpdated: 2026-11-27T18:43:29.598553784-05:00
WhatFor: "Reconstructing what was done and in which order, with the command outputs that justify it."
WhenToUse: "Reviewing the change, or repeating it on another branch."
---

# Implementation diary

## Step 0 — read the two defects in the code

- `src/framework/passes/define-pass.ts:201` (`prepareNative`) took the caller's `IRStore` and opened the candidate
  with it; `src/framework/ir/view.ts:190` (`openIR`) calls `store.retain(snapshot)`, which seeds a lineage and sets
  its head.
- `applyPass` (`define-pass.ts:345-389`) called `manager.verifyTransformation(...)` with default options, which
  commits; the preservation loop ran after it and could still throw `preserveViolated`.
- `manager.verifyTransformation(..., { deferCommit: true })` exists and returns a `PreparedTransformation` with
  `commit`/`rollback` (R3 probe 03, item 3).
- The store's real commit protocol is `#publish` (base, next, acceptance, generation) behind the internal
  `publishRevision`, plus `retain` for seeding a lineage. `Edit.commit` publishes a revision and its semantic
  acceptance together; nothing else could publish a revision that is not an edit of the same artifact id.

## Step 1 — probe before the change (evidence)

`node ttmp/2026/11/27/IRWB-045-C--.../scripts/01-publication-before-acceptance.mjs`, after `npm run build`:

```
1. rejecting contract, caller store, fresh output id: contractRejected: ...
   store.head("candidate") after the rejection: revision 27c9301c1a75 (the rejected candidate: true)
2. preservation failure: preserveViolated | last execution status accepted | facts about the rejected candidate: 1 probe.single-statement ok=true
3. deferCommit: facts visible before commit 0 | after rollback 0
4. accepted application, store, the input's id: ir.unpublished: Unknown revision of tix; new revisions must be committed through an ed | store head: e662b30fa2a7
5. applyNativePassSync on the honest gate for this program: accepted (sync runner)
```

Item 4 was not in R3's probe: with a store and the default `outputId`, an *accepted* application failed with
`ir.unpublished`, because `retain` refuses to advance a head. That settled the publication API: the boundary has to
advance a head, not only seed one.

## Step 2 — design

`design-doc/01-publish-a-pass-result-only-after-it-is-accepted.md`, committed before any code:

- preparation is private (`prepareNative` stops taking a store);
- the contract runs deferred; preservation claims run next; any rejection rolls the deferred evidence back;
- the boundary is one `IRStore.publish(next, { base?, generation?, acceptance })` call, carrying the manager's
  prepared transformation as the store's `EditAcceptance`, so the head and the evidence become visible in the same
  atomic publication;
- a store refusal is its own `IRError`, not a pass-rejection code.

## Step 3 — the store's publication primitive

`src/framework/ir/store.ts`: `#publish` takes `base: Artifact | undefined`; `publish` is public and passes the
options through; opening a lineage without `base` keeps `retain`'s rule (no head may exist) and starts at
generation 0. `retain` and `publishRevision` are unchanged in behaviour.

## Step 4 — the pass runner's boundary

`src/framework/passes/define-pass.ts`:

- `prepareNative` opens the candidate on `openIR(after, pass.adapter)`, i.e. a fresh private store;
- `applyPass` reads `options.store.generation(before.id)` right after opening the input (the value a head advance
  is checked against) and calls `verifyTransformation(..., { deferCommit: true })`;
- the preservation loop and the publication are inside one `try`; the `catch` calls `discardEvidence` (rollback
  unless the execution is already accepted) and rethrows, so `preserveViolated` no longer leaves an accepted
  execution or a fact behind;
- `publishAccepted` publishes once: head advance when the output keeps the input's id, lineage opening for a fresh
  `outputId`, `prepared.commit()` when there is no store.

## Step 5 — the tests

`tests/framework/r3-defects.test.mjs`: the two `todo: 'F33'` options removed, assertions untouched.

```
$ node --test tests/framework/r3-defects.test.mjs
✔ F33: a candidate the contract rejects does not become a store head (17.314296ms)
✔ F33: no accepted execution or fact survives a later preservation failure (69.433991ms)
⚠ F34 ... # F34   (todo, other step)
⚠ F35 ... # F35   (todo, other step)
```

## Step 6 — probe after the change, and the accepted side

`scripts/01-publication-before-acceptance.mjs`:

```
1. rejecting contract, caller store, fresh output id: contractRejected: ...
   store.head("candidate") after the rejection: none
2. preservation failure: preserveViolated | last execution status rolled-back | facts about the rejected candidate: 0
3. deferCommit: facts visible before commit 0 | after rollback 0
4. accepted application, store, the input's id: changed=true revision=27c9301c1a75 | store head: 27c9301c1a75
5. applyNativePassSync on the honest gate for this program: accepted (sync runner)
```

`scripts/02-accepted-publication.mjs` (new; the accepted side):

```
1. inline then split-sum on one store: changed true true | r1 7476d4fe8e6a | r2 e49d3852013e | head e49d3852013e | head is the second result: true | revisions 3 | generation 2
2. an application from the superseded base: ir.stale-edit | head still the chain's last result: true | revisions 3
3. accepted application: execution accepted | facts about the result 1 probe.nonempty ok=true
4. a rejected application: contractRejected | head is the input it opened: true | revisions 1 | generation 0 | executions 1 last rejected
```

One wrong first draft of item 1 used a program with no reduction (`split-sum` failed to parse, then the second
application was a no-op because `inline` had already folded everything): the item now uses a pointwise definition
inside a reduction so both applications change.

## Step 7 — formatting

`src/framework/ir/store.ts` and `src/framework/passes/define-pass.ts` were **not** Prettier-clean before this
change (`prettier --check` on the committed versions fails), so Prettier was not run over them; the additions are
written in the surrounding style. `src/framework/ir/README.md` gained one clause on `store.publish`.

## Step 8 — suites and baselines

See the report (`reference/02-report-...md`) for the full numbers.
