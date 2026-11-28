---
Title: 'Report: F33, publication only after acceptance'
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
    - src/framework/ir/README.md
    - tests/framework/r3-defects.test.mjs
ExternalSources: []
Summary: "F33 is implemented with one acceptance boundary: a private candidate, a deferred contract, and one atomic store publication that carries the manager's evidence."
LastUpdated: 2026-11-27T18:43:29.598553784-05:00
WhatFor: "The result of IRWB-045-C: what changed, what the acceptance checks printed, and what is left."
WhenToUse: "Reading the outcome of F33, or checking that a later step kept it."
---

# Report: F33, publication only after acceptance

## What the step asked for

Acceptance of a pass application was not atomic in two places: a candidate the contract rejected stayed the head
of a caller-supplied `IRStore` (because `prepareNative` opened it with that store and `openIR` retains), and the
manager recorded an accepted execution and its facts before the preservation checks, which could still reject.

## What changed

- `src/framework/passes/define-pass.ts` — `prepareNative` no longer takes a store: the candidate is opened on a
  private one, so preparing publishes nothing. `applyPass` captures the input's store generation, runs the
  contract with `{ deferCommit: true }`, wraps the preservation loop and the publication in one `try` whose
  `catch` rolls the deferred evidence back (`discardEvidence`) and rethrows, and publishes once through the new
  `publishAccepted` (head advance when the output keeps the input's id, lineage opening for a fresh `outputId`,
  `prepared.commit()` when no store was given). The header comment states the boundary.
- `src/framework/ir/store.ts` — `IRStore.publish(next, { base?, generation?, acceptance? })`: the store's
  publication point for a revision prepared elsewhere. `#publish` takes an optional base; with one it is the edit
  commit protocol (compare-and-swap against head and generation, same id/kind/schema), without one it keeps
  `retain`'s rule (no head may exist) and starts the lineage at generation 0. The `acceptance`'s synchronous
  `commit()` runs inside the publication window, so the head and its evidence become visible together. `retain` and
  the internal `publishRevision` are unchanged in behaviour.
- `src/framework/ir/README.md` — one clause naming `store.publish` next to the head/publication sentence.
- `tests/framework/r3-defects.test.mjs` — the two `F33:` tests lose their `todo` option; assertions untouched.
- `ttmp/2026/11/27/IRWB-045-C--.../design-doc/01-...md` — the design, committed before the code.
- `ttmp/2026/11/27/IRWB-045-C--.../scripts/01-publication-before-acceptance.mjs` — R3 probe 03's two claims plus
  three controls (deferred commit, an accepted application with a store, the sync runner), run before and after.
- `ttmp/2026/11/27/IRWB-045-C--.../scripts/02-accepted-publication.mjs` — the accepted side: a two-step chain on one
  store, a stale base, the accepted evidence, and a rejected application on a fresh store.

Nothing under `src/typed/` or `src/tensor/` changed.

## The two defects, before and after (scripts 01 and 02)

| | before | after |
|---|---|---|
| rejecting contract, caller store, fresh output id | `contractRejected`, and `store.head('candidate')` is the rejected candidate | `contractRejected`, `store.head('candidate')` is `none` |
| contract establishes a property, false preservation claim | `preserveViolated`, last execution `accepted`, 1 fact about the rejected candidate | `preserveViolated`, last execution `rolled-back`, 0 facts |
| accepted application with a store, the input's own id | `ir.unpublished` (the store path could not publish at all) | `changed=true`, store head is the result |
| two changing applications on one store | — (the first would already have failed) | head is the second result, 3 revisions, generation 2 |
| an application from a superseded base | — | `ir.stale-edit`, head unchanged, no revision added |
| rejected application on a fresh store | head is the rejected candidate | head is the input it opened, 1 revision, generation 0, last execution `rejected` |

## Acceptance

- **The test.** `node --test tests/framework/r3-defects.test.mjs`:
  `✔ F33: a candidate the contract rejects does not become a store head`,
  `✔ F33: no accepted execution or fact survives a later preservation failure`; the `F34` and `F35` tests remain
  `todo` (other steps).
- **The baselines.** `node ttmp/2026/11/27/IRWB-039--.../scripts/02-baselines.mjs check` after `npm run build`:
  `no differences from .../various/baselines/main.json` (RV32 image hashes, instruction counts and edit records
  for every corpus project under r0, O2 and `speed`; CUDA source hashes and `optimizeTix` revisions for every Tix
  program). The informational timing line moved (`0.527 -> 1.561 ms` per Tix inline application), as it does
  between runs; the script never compares it.
- **The suites** (files, not directories):

  | suite | tests | pass | fail | skipped | todo |
  |---|---|---|---|---|---|
  | `tests/framework/*.test.mjs` | 242 | 240 | 0 | 0 | 2 (F34, F35) |
  | `tests/typed/*.test.mjs` | 188 | 183 | 0 | 2 (`IRWB_CANDELA=1`) | 3 (F36, F37, F38) |
  | `tests/workbench/*.test.mjs` | 25 | 24 | 0 | 1 (`IRWB_FULL=1`) | 0 |
  | `tests/tensor/{corpus,cuda,fusion,language,passes,r3-tix-in-plans,schedule}.test.mjs` | 45 | 44 | 0 | 0 | 1 (F27) |

  The `*-gpu.test.mjs` files were not run (no GPU on this machine).
- **`npm run check`** (tsc, `--noEmit`): clean.
- **`node tools/build-site.mjs`** (changed `src/framework/`): `dist/site built in 537 ms: app.js 3097 KiB,
  app.css 80 KiB, 50 projects, 17 chapters, 131 source files, Candela on demand 1516 KiB`.

## Notes on the framework concepts used

- The publication boundary uses the framework's existing `EditAcceptance` — the interface `Edit.commit` already
  uses to make a revision and its semantic acceptance visible together — rather than a second acceptance protocol.
  `store.publish` extends the store's one commit protocol (`#publish`) with the case "a prepared revision that is
  not an edit of the same artifact id", which `retain` could seed and `publishRevision` could not advance.
- **Machinery that may belong in the framework instead:** `discardEvidence` (rollback unless accepted) is three
  lines in the pass runner; `PreparedTransformation` could carry a `discard(reason)` that is idempotent, which
  would also serve the strategy interpreter's branch cleanup. Not added: one caller today.
- **Missing concept, stated for a later step:** the manager can commit evidence about an artifact revision that its
  caller never published — `prepared.commit()` does not know about the store. A precondition on the commit (the
  artifact must be the head of the store the application used) would make the current boundary enforced rather
  than merely ordered. Left out: no caller needs it while no domain passes a store.

## Left out, and things in the brief or the test I would change

- **No domain code passes a store**, so the publication half is exercised by the tests and these two scripts only.
  The `store` option of `ApplyOptions`/`BridgeOptions` remains latent; wiring the workbench's revision timeline
  through it is a later step (`Later` in the design).
- **The stale-head outcome is an `IRError`, not a `PassError` code.** The design table in IRWB-039 asks that "a
  stale head is its own outcome"; it is one — `ir.stale-edit`/`ir.lineage` distinct from `contractRejected`,
  `preserveViolated`, `undeclaredWrite` — but callers cannot catch it as a `PassError`. Adding a code would add
  vocabulary the brief does not name, so it is left as `IRError`; say so if the intent was a `PassError`.
- **The two tests cannot distinguish "rolled back" from "never committed".** `F33: no accepted execution or fact
  survives…` asserts `status !== 'accepted'`, which both satisfy. The implementation rolls back (status
  `rolled-back`) and script 01 prints it; I did not strengthen the assertion, per the brief's rule.
- **The test's first item asserts the store head is absent, which the store can only guarantee because the
  candidate was never retained.** A caller that seeds a lineage for the output id before applying the pass would
  see its own old head after a rejection (as script 02, item 4 shows for the input's id). That is the intended
  semantics — a rejection publishes nothing, it does not delete pre-existing state — but it is worth knowing when
  reading the assertion.
- **Prettier was not run** on `store.ts` and `define-pass.ts`: both were already unformatted at HEAD (checked with
  `prettier --check` on the committed versions), and the repository's rule is to format only files that were
  formatted before. The added code follows the surrounding style.
- Analyses of a rejected candidate that the preservation recompute produced stay in the manager's analysis memo,
  keyed by exact revision. They are memo entries about a value, not evidence about an application (the test's
  `properties()` and the execution list are both empty/rolled back), and dropping them would need a manager API
  the brief does not ask for.
