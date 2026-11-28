---
Title: 'Design note: credit, provenance and edit classes as queries over the record chain'
Ticket: IRWB-065-A
Status: active
Topics:
    - framework
    - derivation
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "How D1's instruction attribution, D2's hot-shape provenance and A0's edit classification stop re-deriving the optimizer's decisions from IR trees and per-entity origins, and read the records the passes write instead: one framework query module over correspondence chains, classification queries over derivation steps, and the settled reading of A0's 'local' (395)."
LastUpdated: 2026-11-28T00:00:00Z
WhatFor: "Reviewing and implementing phase 4.3 (IRWB-065-A)."
WhenToUse: "Before touching src/typed/attribute.ts, missed.ts, edit-classes.ts or the new src/framework/ir/attribution.ts."
---

# Design note: credit, provenance and edit classes as queries over the record chain

## 1. What changes, in one paragraph each

**D1 (attribute.ts).** `attributeSteps` keeps its signature and output. Its three private accounts of the optimizer's decisions become reads of the record chain:
- *site credit* (which statement an executed instruction implements) now comes from the lowering's own correspondence (`lowerToImage` returns it; its `covered-by` entries are the `covers` lists), not from a scan of `covers` — the chain's last link, blocks to image;
- *the join* (which statement of the revision before a statement of the revision after came from) now comes from the pass's recorded correspondence — which the runner computes from the pass's derivation, and which the tests already check equal to the origin-based computation — not from `origin[0].from`;
- *the reasons* (a group's note and `because` for statements the pass made) now come from the correspondence entries, whose notes and premises are the derivation steps' own words, not from the per-entity origin fields.

What stays: the edit records' kinds and notes name the decisions (they are records the pass writes, and the reproduction check pins the label format to them); the emulator measures; the row format is untouched.

**One framework query module** (`src/framework/ir/attribution.ts`, next to `derivation.ts`). Two domain-independent queries:
- `creditLink(link, before, after)` — one link of a revision chain: joins the sites of the two revisions through the link's correspondence entries, distributes the two weight maps over the groups, and aggregates the naming records that name each group's sites. Returns groups `{key, sites, before, after, keys, notes, because}`; D1 formats decisions and filters unchanged unnamed groups, exactly as today.
- `provenanceLabels(chain)` — for each entity of the chain's last revision, the pass of the link that last changed it: an entry that maps an entity to itself means it survived the link; an entry that maps a source entity to it means that link's pass made it; no changing entry in the whole chain means it predates the chain (Typed: `ingest`). This is D2's provenance.

**D2 (missed.ts).** `hotShapes` gains a `chain` option (the program's revisions, each with its pass name and recorded correspondence). The per-statement provenance label — today a walk over the `origin.via` fields of the statement and every value under it — becomes `provenanceLabels` over that chain. Absent chain (a program at r0): every label is `ingest`, as today.

**A0 (edit-classes.ts).** The class of an edit becomes a query over the derivation steps the edit cites (`Edit.steps`), the same records IRWB-056-B's `locality` reads; the tree-based account (the `placed` locals walk and, for the rule sub-class, `rederive`) is deleted from the classification path. For a `replace` (classified by its chain's net change):
- *local vs structural*: every step the chain's edits cite must be `local` under the **in-place** policy — G's reading, which is what this classifier implements;
- *the sub-class*: a rule step among them → `local/rule` with `{table, fired, weakest}` read from the steps' `by` (the rules that actually fired, in firing order); otherwise a non-guard premise → `local/fact`; otherwise `local/uncited`;
- not all local → `structural`, sub `motion` (or `inline` in a function the application inlined), as today.

A `replace` that cites no steps (a pass that builds its own correspondence, so the records cannot support a claim) is `other/unresolved`.

**The matcher (brief item 3).** `rederive`/`normalize` survive as an **audit** — the check that the derivation's rule names agree with what the rule tables do — with their private template instantiation deleted: `normalize` now builds rule right-hand sides through the standard library's `instantiate` (`src/stdlib/term/terms.ts`) with a `Build` over plain trees, so the only rule-matching semantics left in this file is the `Tree` signature adapter. A new test runs the audit over the O2 corpus.

## 2. Settling 203 against 395: the reading and the evidence

The two counts differ on exactly two `fold` records (probe `scripts/03-a0-counts.mjs`, `various/03-a0-counts-before.txt`): `constants edit:r3.0` and `orders edit:r2.0`. Each is a chain in which `fold-shl`/`fold-mul` computes a constant, a `rebuild` step re-hangs the tree, and `fold-add`/`fold-sub` folds the result — citing, as a premise, the constant the same application's own rule chain made.

A0's header defines `local` as a `replace` "where B reads only locals the input revision already defines: B reads no local this application created and no local this application inserted a `set` for". That definition is about **locals** — variables and the statements that set them — not about intermediate value nodes of a rewrite chain; and the same header says a chain of replaces "form[s] a chain; every member gets the class of the chain's net change". The constant `fold-add` reads is not a local; it is an intermediate of the chain whose net change is the claim. Under that reading the two records are local and the count is **395** — which is what G's tree-based classifier has answered all along.

So the in-place policy's input set becomes: the input revision's entities, plus what the application's own rewrite chains only remade — the products of `rebuild` steps and of **rule steps** — but not locals it created, statements it inserted, or values it made outside a rule chain (`licm`'s hoisted tree, `lvn`'s numbered value: still structural, as their premises cite the inserted statement). `locality` itself is unchanged; the new `inPlaceInput(derivation, sourceEntities)` in `derivation.ts` next to it encodes the settled reading, and the tests state 203 (scoped) and 395 (in-place) with this justification.

## 3. Equivalences the reproduction check rests on

- The correspondence a derived pass publishes equals the origin-based one (`tests/typed/derivations.test.mjs` checks this on every O2 revision), so joining through entries reproduces joining through `origin[0].from`.
- `stepEntries` puts a step's note on the entities it produced and its non-guard premises in the entry's `because`, and for statements (made by `tx.set`/`tx.stmt`, never under a rule) those are exactly the origin's note and `because`.
- An image instruction's `covers` holds at most one statement (`select.ts` builds `[value, stmt]`), so "the first cover that is a statement" is the statement among the covered-by entry's sources, order-independent.
- Differential probes (this ticket's `scripts/`) compare old and new outputs beyond the two required tables: D1 on the corpus projects under O2 and `speed`, D2 on the three benchmark programs the tool was run on, A0's classes on the O2 corpus and the `speed` test projects.

## 4. What remains, and why (brief item 4)

Deleted: D1's `groupOf` origin walk and `covers` scan; D2's `origin.via` walk; A0's `placed`-locals walk and `reads` (the whole second account of locality); A0's private template instantiation. Kept: `rederive`/`normalize` as the audit above (a choice stated, per the guide's open question 2); the tree bookkeeping that is not classification (`parts`, `shapeOf`, `treeOf`, `sameTree` — descriptions of what changed, used by `instructionWeights` and the shape labels); the edit records as the decision labels' format.
