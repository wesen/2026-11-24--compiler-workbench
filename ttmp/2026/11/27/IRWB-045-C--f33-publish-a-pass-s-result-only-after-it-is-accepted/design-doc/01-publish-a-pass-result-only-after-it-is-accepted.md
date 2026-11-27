---
Title: Publish a pass result only after it is accepted
Ticket: IRWB-045-C
Status: active
Topics:
    - framework
    - verification
    - refactor
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - src/framework/passes/define-pass.ts
    - src/framework/ir/store.ts
    - src/framework/ir/view.ts
    - src/framework/contracts/analysis-manager.ts
ExternalSources: []
Summary: "F33: one acceptance boundary in the pass runner. A candidate is prepared on a private store, the contract runs deferred, and the output revision and its evidence become visible together, or not at all."
LastUpdated: 2026-11-27T18:43:29.598553784-05:00
WhatFor: "The change this ticket makes, the alternatives it rejects, and what a rejection is allowed to leave behind."
WhenToUse: "Reading or reviewing F33, or changing the pass runner's publication path."
---

# Publish a pass result only after it is accepted

## Executive Summary

Applying a pass has one acceptance boundary. Everything before it is private to the application: the candidate
revision lives on a store the caller cannot see, and the contract's evidence lives in a deferred transaction the
manager has not committed. At the boundary the candidate becomes the store's head and the evidence becomes
committed facts in the same atomic step. Any rejection before the boundary publishes neither.

Today the boundary is missing on both sides:

- `prepareNative` opens the candidate with the caller's `IRStore`, and `openIR` retains it there immediately, so a
  candidate the contract then rejects is the store's head (`probe 01`, item 1).
- `applyPass` runs the contract through `manager.verifyTransformation`, which commits the prepared execution and
  the property facts it established, and only afterwards checks the preservation claims, which can still reject.
  The facts and an `accepted` execution survive the rejection (`probe 01`, item 2).

The ticket's acceptance is the two `F33:` tests of `tests/framework/r3-defects.test.mjs`, with the corpus
baselines unchanged.

## Problem Statement

Two different people can observe a rejected candidate.

**The store.** `applyPass(pass, before, { store })` opens the input on `store` and `prepareNative` opens the
candidate on the same store. `openIR` calls `store.retain(artifact)`, which seeds a lineage and sets its head. A
caller that supplies a store therefore gets the rejected candidate back from `store.head(outputId)` — and, worse,
`revision` and `generation` move as if a revision had been accepted. The same path is also unable to publish a
*correct* result under the input's own id: `retain` refuses to advance a head (`ir.unpublished`), so with a store
and the default `outputId` an accepted application fails today (item 4 of the probe). The store option is latent —
no domain code passes one — but the v7 plan wants publication through the framework, so it has to be right.

**The manager.** `verifyTransformation(...)` without `deferCommit` commits: `execution.status = 'accepted'`, and
every analysis and property fact the contract's checks produced moves from the transaction's overlay into the
manager's store. The preservation claims are checked after that call, and a claim that fails throws
`preserveViolated`. The rejected candidate is then an established property of the manager, with an accepted
execution as its evidence — `manager.properties(candidate)` is non-empty and `snapshot().executions.at(-1)` says
`accepted`. A later `explainProperty` would report a property of an IR revision that was never published.

## Supported input domain

The behaviour specified here is about `applyPass` and `applyNativePassSync` on their declared signatures, for
passes whose runs terminate and whose adapters satisfy the IR layer's existing contract (valid artifact, valid
graph, `Rewritable` where a rebuild is needed). Nothing here concerns concurrent applications on *different*
managers, or an adapter that blocks indefinitely inside `rebuild`.

## Proposed Solution

One boundary, in `src/framework/passes/define-pass.ts`, and one publication primitive under it in
`src/framework/ir/store.ts`.

### 1. Preparation publishes nothing

`prepareNative` stops taking the caller's `IRStore` and always opens the candidate on a private store
(`openIR(after, pass.adapter)`, which makes one). It returns the artifact, the change set and the correspondence;
the candidate is a plain artifact value from then on. Both runners call it, so neither can make a candidate
visible by preparing it.

Consequence: the input `before` is still retained on the caller's store (that is what `openIR` at the top of
`applyPass` does, and it is the input, not a result), and the candidate is retained only on the private store,
which dies with the view.

### 2. The manager's evidence stays deferred until the boundary

`applyPass` calls `manager.verifyTransformation(..., { deferCommit: true })` and keeps the returned
`PreparedTransformation` in `prepared`. A failed contract check already closes the transaction inside
`verifyTransformation` (`fail`), so a `contractRejected` has nothing left to roll back.

The preservation claims then run exactly as they do now (`manager.preserve`, else the recompute comparison). Every
rejection after the deferred verification — `preserveViolated`, or any other throw, including `undeclaredWrite`
raised earlier — rolls `prepared` back with reason `Pass <id> rejected: <message>` before it propagates. Rollback
discards the overlay: the facts never reach `manager.properties`, and the execution's status is `rolled-back`, not
`accepted`.

### 3. The boundary: one store publication carrying the evidence

`IRStore` gains `publish(next, { base?, generation?, acceptance? })`, the store's publication point for a revision
that was prepared elsewhere:

- with `base`, it advances that lineage's head under the same compare-and-swap an edit commit uses
  (`assertHead(base, generation)`, same id/kind/schema, `ir.lineage`);
- without `base`, it opens a lineage: the store must not already hold a head for `next.id` (`ir.lineage`), which
  is the rule `retain` already applies;
- in both cases an `acceptance` runs synchronously inside the store's atomic publication window, so the head and
  the evidence that justifies it become visible in the same step, and a throwing commit leaves the store unchanged.

`applyPass` then publishes once, after every check has passed:

- store supplied, output id equal to the input's: `store.publish(after, { base: before, generation, acceptance })`,
  where `generation` is read from the store right after the input is opened;
- store supplied, a fresh output id: `store.publish(after, { acceptance })` — a lineage opening;
- no store: `prepared?.commit()`; that is the whole publication, since nothing else is visible.

`acceptance.commit` is `prepared.commit()` and `acceptance.rollback` is `prepared.rollback`. A store refusal (a
stale head, a colliding lineage) propagates as its own `IRError` — not `contractRejected`, not `preserveViolated` —
and the prepared transaction is rolled back first, so a failed publication publishes nothing either.

The synchronous runner needs no boundary of its own: it takes no store and no manager, its candidate is now
explicitly private, and its gate runs before it returns. Its accepted results are unchanged, and the baselines
check that the CUDA sources and the `optimizeTix` revisions are unchanged too.

### What a rejection leaves behind

| where | after a rejection |
|---|---|
| the caller's `IRStore` | no head under the output id (or, if the store already held one, exactly the head it held before); no revision, no generation bump |
| the manager | no fact about the candidate; the execution is `rolled-back`; overlay history is copied to `factHistory`/`analysisHistory` marked invalid, which is the manager's existing record of a discarded transaction |
| the manager's analysis memo | analyses of the candidate computed by the preservation recompute stay cached, keyed by exact revision: they are memo entries about a value, not evidence about a pass application |
| the result | the call throws the same `PassError` code as today (`contractRejected`, `preserveViolated`, `undeclaredWrite`, `illegal`, `badResult`) |

## Design Decisions

**The boundary is one `IRStore.publish` call that carries the acceptance, not two calls ordered by the runner.**
The simplest alternative is to keep `store.retain(after)` and call `prepared.commit()` next to it. It cannot be
made atomic: either the head moves before the evidence commits (a committed failure leaves a head whose evidence
is gone) or the evidence commits before the head (the defect being fixed, one level up). Passing the
`EditAcceptance` — the interface `Edit.commit` already uses for exactly this — into the store's publication keeps
one place where a revision and its evidence become visible.

**`IRStore.publish` generalises the store's existing commit protocol rather than adding a second one.** The store
already had two ways to make a revision visible: `retain` (seed a lineage, no evidence) and the internal
`publishRevision` (advance a head under compare-and-swap, with an `EditAcceptance`). Publication of a prepared
candidate is the union of those two cases, so `#publish` takes an optional base and `publishRevision` and `retain`
keep their current entry points. The alternative — teaching `define-pass.ts` to choose between `retain` and
`publishRevision` itself and to sequence `prepared.commit()` around them — would put the publication protocol in a
pass runner and leave the non-atomic order available.

**The generation captured when the input is opened is what a head advance checks.** A pass application awaits the
contract between opening the input and publishing, so another application on the same store can win in between;
`ir.stale-edit` then says so. The alternative, `assertHead(before)` at publication time only, catches a moved head
but not a head that moved away and back to the same revision.

**Rollback of the deferred evidence on rejection happens in the runner, not in the store.** The store only sees an
`acceptance` when publication is attempted; rejections before that never reach it.

**Nothing new is recorded for a rejection.** No event, no fact, no status beyond the manager's existing
`rolled-back` execution. The alternative — a `PassError` code for "not published" — adds vocabulary the brief does
not name and that no caller needs: today's codes already distinguish the rejection reasons, and a publication
refusal keeps its `IRError` code.

## Alternatives Considered

- **`try`/`finally` around the existing two commits (store retain, manager commit).** The shortest patch, rejected
  above: neither order survives a failure of the second step.
- **Prepare the candidate, run the contract deferred, and pass a `commit`/`rollback` pair straight into
  `Edit.commit`'s `verify` hook.** This is the same atomicity through a different door: it would express a pass
  application as a no-op IR edit whose commit calls the manager. It loses the direct publication path for a native
  pass (no edit is created when `run` returns a native value — `IRWB-019 F13`) and needs a `Rewritable` adapter for
  passes that do not have one, so the pass runner would depend on a capability its passes do not need.
- **A second, staging `IRStore` that the caller swaps in on acceptance.** Loses the caller's own lineage rules and
  CAS: the caller's store holds the head, and two stores holding the same artifact id would both be able to
  publish. It also does not address the manager half.
- **Put the deferral inside the manager: `verifyTransformation` keeps `deferCommit` but the pass's preservation
  claims become part of the contract.** That is the right long-run shape (the v7 plan's "obligations"), but it
  changes what a pass declares and what the contract can see; this step keeps the declarations and moves the
  commit.

## Implementation Plan

1. `src/framework/ir/store.ts`: `#publish` takes an optional base; add `IRStore.publish`; keep `retain` and
   `publishRevision` behaviour.
2. `src/framework/passes/define-pass.ts`: `prepareNative` opens the candidate privately; `applyPass` verifies
   deferred, rolls back on every later rejection, and publishes once.
3. `tests/framework/r3-defects.test.mjs`: remove the two `todo` options of the `F33:` tests (assertions unchanged).
4. `scripts/01-publication-before-acceptance.mjs`: the probe, rerun after the change.
5. `npm run build`, the four suites, the baselines check, `npm run check`, `node tools/build-site.mjs`.

## Later

- Publication through a strategy plan's `onResult`/revision timeline (no domain code passes a store today, so the
  new path is exercised by the tests only).
- Whether the manager should refuse to commit evidence about an artifact that its caller never published (a
  `commit` precondition on the artifact revision). One line in the manager once a caller needs it.
- Folding preservation claims into the transformation contract's obligations (phase 3).

## Open Questions

- Should a store refusal (stale head) be a `PassError` code, or stay an `IRError`? Left as `IRError`: it is a
  store-level outcome, and no caller needs to branch on it differently from any other failed application.

## References

- R3 probe: `ttmp/2026/11/26/IRWB-019--.../various/r3-synthesis/scripts/03-publication-before-acceptance.mjs`
- `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/design-doc/01-...md`
  (phase 1b, F33)
- `tests/framework/r3-defects.test.mjs`
