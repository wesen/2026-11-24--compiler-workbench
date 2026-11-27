---
title: One acceptance boundary for a pass application (F33)
description: Where the boundary sits, what stays private until it, and what a rejection leaves behind.
doc_type: design-doc
topics: [framework, passes]
ticket: IRWB-045-B
---

# F33: publish a pass's result only after it is accepted

## The defect (R3 probe 03)

Acceptance of a pass application is not atomic today, in two ways:

1. **The store.** `prepareNative` (`src/framework/passes/define-pass.ts:223`) opens the candidate
   artifact with the caller's `IRStore`; `openIR` (`src/framework/ir/view.ts:190`) retains every
   view it opens, so a candidate the contract then rejects is already the store's head.
2. **The manager.** `applyPass` runs the contract through `manager.verifyTransformation`, which
   commits immediately: the execution is recorded as `accepted` and the contract's facts
   (e.g. an `establishes` fact about the candidate) enter the manager's store. Only then do the
   preservation checks run, and they can still throw `preserveViolated` — the accepted execution
   and the candidate's facts stay.

## The boundary

One boundary wraps one `applyPass` application. Everything the application produces about the
*candidate* is private until the boundary; the boundary publishes all of it together, or nothing:

- **Private until the boundary**
  - the candidate artifact and its view: `prepareNative` opens it on a **private store** (a
    throwaway `IRStore`), so retaining it has no caller-visible effect;
  - the contract execution and its facts: `verifyTransformation` runs with the manager's existing
    `{ deferCommit: true }`, so they sit in the transaction's overlay;
  - preservation evidence about the candidate: transfer records and recompute analyses name the
    candidate as subject; on rejection they are invalidated (see below).
- **At the boundary (all checks passed: legal, writes, contract, preservation)**, in this order:
  1. `prepared.commit()` — the contract's execution and facts become public;
  2. `store.retain(candidate)` — only for a native result, and only when the caller supplied a
     store: exactly the publication `openIR` performed before, moved after acceptance.
- **On any rejection, publish nothing**: the prepared contract is rolled back (`rollback`, which
  also discards the overlay), and every analysis record the preservation checks wrote *about the
  candidate* is invalidated via the manager's public `invalidate`. The error propagates unchanged
  (`contractRejected`, `preserveViolated`, …).

`applyNativePassSync` has no manager and no caller store; its candidate already opens on a private
store, so it needs no change beyond the `prepareNative` signature it shares.

## What a rejection leaves behind

- analyses the application computed about the **input** (the `needs`, and the preservation
  source facts): the input was already accepted; these are ordinary published facts about it;
- **invalidated tombstones**: the preservation evidence about the candidate stays in the analysis
  history marked `valid: false`, and the rolled-back contract's overlay facts are discarded the
  same way the manager's own `discard()` already treats provisional transactions — the framework's
  established idiom is "no *valid* fact survives", not "no record ever existed";
- events (`analysis.computed`, `transformation.rolled-back`, `information.invalidated`, …);
- the contract execution, with status `rejected`/`rolled-back`, never `accepted`.

## Decisions and alternatives

- **Move `openIR`'s retain instead of adding a store rollback API.** Alternative: teach `IRStore`
  an unretain/rollback. Rejected: `retain` throws before mutating when it would refuse (forged or
  already-headed artifacts), so simply *not calling* it until acceptance needs no new store
  protocol. Consequence: for the combination (caller store) × (same artifact id) × (changed
  revision), publication now throws `ir.unpublished` *after* the checks instead of before them,
  and a contract rejection now wins over it. No current caller uses that combination (the only
  store-passing caller of `applyPass` is the test; `bridge.ts`'s `store` option is never supplied).
- **Commit the contract before retaining the store head.** A store head must never exist without
  full acceptance, so the semantic commit goes first; a `retain` failure then leaves an *accepted*
  candidate that is merely not visible in a misused store — today's edit path already behaves that
  way (it never retains at all).
- **Invalidate preservation evidence rather than a new provisional-scope concept.** Alternative: a
  public overlay scope in `AnalysisManager` (like `beginTransformation`'s private overlay) that
  `applyPass` would open for the preservation checks. Rejected for this step: a scope frame would
  have to declare the effects of every transitively used analysis up front (`effectAllowed` walks
  the parent chain), which changes permission semantics for analyses run under it. `invalidate` is
  an existing public concept, leaves exactly the tombstones the manager's own rollback leaves, and
  keeps every valid fact about the candidate out of the store. See "Later".
- **Keep the contract-before-preservation order.** The header of `define-pass.ts` documents that
  order; swapping them would change which error a doubly-failing application reports.

## Assumptions (supported domain)

- The pass's contract does not depend on a fact the preservation loop recomputes to a new
  generation: between deferred `verify` and `commit`, `commit` re-validates the contract's
  dependencies and fails closed (`stale-evidence`, nothing published) if one changed. With the
  corpus passes this cannot arise (the typed meaning contract reads no analyses; the preserved
  dataflow facts are cacheable), so no alias detection is built.
- `retain` on the caller's store only publishes candidates it would have published before: a fresh
  artifact id, or an exact already-retained revision (a no-op).

## Later

- a public provisional (overlay) scope in `AnalysisManager`, so preservation evidence about a
  candidate is never even temporarily visible; second use: any future pass runner gets the same
  boundary for free;
- one runner (IRWB-039's own step) will subsume `applyNativePassSync` and `applyPass`.
