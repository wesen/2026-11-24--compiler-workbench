---
Title: 'Diary: derivations (IRWB-056-B)'
Ticket: IRWB-056-B
Status: active
Topics:
    - framework
    - derivation
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
WhatFor: "The order the work happened in, and what each measurement said"
WhenToUse: "When reviewing this step"
LastUpdated: 2026-11-27T23:55:00-05:00
---

# Diary

Step 0. Read the brief, R3's K2 and the migration step, `src/typed/tx.ts`, `src/typed/rules/compile.ts`,
`src/typed/passes.ts` (`revisionCorrespondence`, `typedPass.prepare`), `src/framework/ir/correspondence.ts`,
`define-pass.ts`, `transformation.ts`, `src/tensor/passes.ts`. Built the worktree (`npm install`, `npm run build`).
Counted the O2 census from the coordinator's baselines: 1,774 edit records, simplify 140 and fold 43 — 183, the number
the brief asks for.

Step 1. Probe 01 on the unchanged tree: the O2 corpus is ~19–27 s (best of 3, the machine is shared); a simplify edit's
correspondence makes no link for the values it rewrote (only `removed` and `retained`), which fixed the target for
"equal to today's": the correspondence is about *survival*, so a rewrite that produces an entity the input already had
legitimately maps nothing. Also: firings outnumber records (145 firings, 139 records on one application), so a record
cites a list of rules.

Step 2. `src/framework/ir/derivation.ts`: `DerivationStep`, `Derivation`, `makeDerivation`, `validateDerivation`,
`correspondenceFromDerivation`, `locality`. First cut sorted every entity list; that destroyed the antecedent order and
the correspondence with it — lists now keep the producer's order (the first consumed entity is the antecedent).

Step 3. Carried it: `NativeResult.derivation`/`coverage`, `prepareNative` validates the sites and computes the
correspondence from the steps, `PassResult.derivation`, `Revision.derivation`.

Step 4. `Tx`: a shared step list, `withRule`, a step per made entity (`made`), per in-place rule firing (`inPlace`), per
structural edit (`editStep`), and `Edit.steps`. `compile.ts`: `guardPremises`, `becauseEntities`, `subtree`, and the
rule applied under `withRule`. `typedPass.prepare` returns `makeDerivation(spec.name, steps)`; the tables pass their own
name.

Step 5. First corpus run: 324 citing records, 3,528 records — the probe applied every pass to `r0` without publishing.
Fixed the probe to run the pipeline; then a series of real defects, each found by a *difference* and each a lesson:

- `tx.local` made an entity with no step → "names no site". Fixed by making the entity's step exist and having the edit
  cite it.
- `retarget`/`move` steps produced the block they jump to, so a fresh preheader looked like something the input
  entity became (`regex-nfa`, `my-analysis`). A moved or retargeted statement is the same entity; it produces nothing
  new.
- `unreachable` steps carried `because: ['cfg']`, so a dropped block's `removed` entry grew a reason the fill never gave.
  The step of a dropped block carries no premise.
- An edit whose only pending steps were made *before* a `tx.rewrite` (lvn's `tx.get` handed to `tx.replace`) lost them,
  and its rewrite looked local. The pending list is now cleared at the end of a walk, not at the start of each field.
- A `pe`/`promote`/`note` record names no entity at all: it cites no step.
- A pass that builds its own correspondence (`makeInline`) passes no step list, so its records cite nothing.

Step 6. Corpus (O2 + `speed`, 547 applications, 10,622 edit records): no differences from `revisionCorrespondence`; 183
records cite a rule under O2; the scoped policy answers 203 exactly. The in-place policy answered 393 against G's 395:
the two are `fold-add` records folding a constant tree the same application computed (`fold-shl` on `constants` and
`orders`). Recorded both numbers and the cause in the test rather than bending the policy: the reading that would
include them ("what the application computed is input-like") also pulls in `lvn`'s seven replaces and gives 402.

Step 7. Cost: in-build, 15.98 s vs 14.90 s for the same corpus with the correspondence taken from origins (1.07x), and
today's correspondence computation is 20.8 % of a run. Then the base commit built from its own sources beside this build
(`scripts/04-cost-before.sh`), interleaved: 11,190 ms vs 11,026 ms, 0.99x. Gate passed; no local terms stored on demand.

Step 8. Tests: `tests/framework/derivation.test.mjs` (the type, the site check, the three rejections, the merge, the two
policies), `tests/typed/derivations.test.mjs` (the corpus: equality, 0 → 183, 203/393, Tix inline). Updated
`tests/typed/rules.test.mjs`: the table-vs-hand-written comparison now compares the revision, the records' *sites* and the
correspondence (the attribution is what the table adds and the hand-written body cannot say), plus a new test that the
table's records cite exactly the rules the classifier re-derives from the two trees.

Step 9. Baselines: `no differences`; inline's per-application time 0.562 → 0.578–0.626 ms (informational only; the pass
now also builds the merge steps). Suites: framework 266/266, tensor+stdlib+workbench 383/384 (1 skipped), typed 192/194
(2 skipped, 0 failing). `npm run check` clean; `npm run format:check` reports the same eight files it reported before
this step (none of mine).
