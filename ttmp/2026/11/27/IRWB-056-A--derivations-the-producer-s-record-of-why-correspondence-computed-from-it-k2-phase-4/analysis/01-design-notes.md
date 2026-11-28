---
title: Design notes
---

# IRWB-056-A: derivations (R3 concept K2, phase 4)

A pass's edits say *what* changed. A **derivation** is the producer's own record of *why*: for each step,
the rule or decision it applied (`by`), the site (the entities it `consumes` in the input revision and
`produces` in the output), the premises (`premises`, the facts or entities it relied on), and the `relation`
the producer claims between them. The correspondence between the two revisions is then computed *from* the
steps, and the existing diff audits the steps' claims.

## What was built

1. **The record** — `src/framework/ir/derivation.ts`: `DerivationStep` (`by`, `consumes`, `produces`,
   `premises`, `relation`, optional `note`), `stepsToCorrespondence` (validation + grouping into
   correspondence entries) and `correspondenceOfDerivation` (entries + `makeCorrespondence`'s coverage
   completion). A transformation's result carries its `derivation` next to its edits and correspondence
   (`NativeResult.derivation`, `PassResult.derivation`; `runTransformation` passes it through;
   `prepareNative` computes the correspondence from the steps when the producer recorded any — a
   hand-written `correspondence` is ignored then).
2. **Typed writes rule ids** — `Tx` records a step per entity it makes from an entity of the input revision
   and per removed input entity; `MakeOptions.rule` and `Tx.cite` name the rule that licensed it.
   `compileRules` cites the matched rule and threads it into every value the instantiation makes
   (`rules/compile.ts`), so the rule passes (fold, simplify, identities) write records citing rules
   (`rules`) and the facts they used (`licensed`): 0 → 183 on the O2 corpus (fold 43 + simplify 140).
3. **Tix records merges** — `tensor/passes.ts` `inline` records which statement was merged into which;
   chains resolve to the final survivor (`mergeSteps`).
4. **Correspondence from steps** — for every pass that records a derivation, the derivation-computed
   correspondence equals the one computed today from origins and removal edits (`revisionCorrespondence` +
   completion): the whole O2 corpus (195 changed revisions) and the whole speed corpus (368 revisions,
   `scripts/02-speed-corpus-equality.mjs`) agree bit for bit. Empty sites and false mappings (an id in
   neither revision; a produced id the diff says was removed; a consumed id that exists only in the output)
   are rejected by `stepsToCorrespondence`, which the runner calls for every pass with a derivation.
5. **Classification stays a query** — no class field on a step (R3's decision). A0's two policies both come
   from the same records in `tests/typed/derivation.test.mjs`: policy B (a value rewrite licensed by a
   verified rule or a checked fact) = 203; policy G (IRWB-035-G's classifier, a query over the same
   before/after/edits) = 395.

## Decisions, with the simplest alternative each displaces

- **One step per made/removed entity, not per edit record.** The simplest alternative — a step per edit
  record — falls short: `Tx.rewrite`'s rebuilds create new values that today's correspondence already maps
  (origins), but write no edit records of their own, so per-record steps could not reproduce today's
  entries. Per-entity steps mirror exactly what `revisionCorrespondence` reads (an origin with `from` in
  the input, or a removal), which is what makes the equality check exact.
- **The runner computes the correspondence; the domain does not hand-write entries.** The alternative —
  keep `produced.correspondence` as the source and store steps beside it — is exactly today's state, and
  K2's finding is what it produces: Tix `inline`'s producer came out `removed` with no link to the
  consumer. With steps as the source, `inline`'s entry is `merged` into the surviving statement. This is
  the one intentional change to a published correspondence; the Tix baseline records revisions and CUDA
  source, not correspondences, and no test asserted the old entry.
- **The producer filters superseded steps; the runner stays strict.** A made entity can die within the
  revision (pruned at `commit`, or consumed and replaced by a later step of the same rewrite). The runner's
  validation rejects any site naming an entity that is in neither revision, so `typedPass` drops steps
  whose product did not survive the commit (the derivation carries the published revision's boundary).
  The alternative — a silent drop inside `stepsToCorrespondence` — would make the auditor share the
  producer's blindness.
- **`relation` is the producer's vocabulary.** Typed names it by the pass (what the origin's `via` says
  today, so the entries are identical); Tix names a merge `merged`. The alternative — a framework enum
  (`modified`/`merged`/…) — would standardize one domain's reading, as A0's 203-vs-395 spread argues
  against for classes.
- **The derivation's step order follows the revision's tables** (values, then statements, then blocks,
  each id-sorted; removals last). Found by the speed probe: one `licm-traps` rotate revision differed
  only in the order two notes were joined in one entry. The alternative — sort notes at join time — would
  not match today's (unsorted) join, and the acceptance is equality with today's computation.

## The decision point, measured

`scripts/01-correspondence-cost.mjs` (gate off, whole corpus, three interleaved runs per side; numbers in
`various/01-correspondence-cost.txt`): pipeline medians 9.5 s before and after; today's correspondence
computation re-measured at 3.8–4.6 s before, 3.4–4.8 s after. Recording derivations is indistinguishable
from noise, far below the 2× threshold, so nothing is stored only on demand — in fact no local terms
(before/after JSON per step, R3 K5's `before`/`after`) are stored at all: a step is one small object per
made or removed entity, O(changes), and the equality checks are O(steps).

## Left out (and why)

- Typed `inline` and `dfe` record no derivations: they do not work through `typedPass`'s `Tx` loop (they
  are whole-program transformations), they apply no rules, and the ticket's scope names the rule passes
  and Tix `inline`. Their correspondences are unchanged.
- `Program`'s revision records do not carry the derivation (`src/typed/program.ts` is outside the named
  scope); the tests read it off the `TransformationResult`, which carries it.
- `whyEntity` still walks correspondences, not derivations (R3's `why` over derivations is a later step).
- The `*-gpu` tests and `npm test` were not run, per the brief.
