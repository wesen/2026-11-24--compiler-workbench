---
Title: 'Design note: attribution, provenance and classification as queries (lane 4.3, IRWB-065-B)'
Ticket: IRWB-065-B
Status: active
Topics:
    - framework
    - derivation
    - ir
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Short design note written before the change: one framework query module over a chain of correspondence-and-derivation records, the three Typed adapters rewritten on it, the two locality policies settled at A0's reading (395), and what of the old machinery remains."
LastUpdated: 2026-11-28T00:00:00-05:00
WhatFor: "Reviewing lane 4.3 before the code: what the query is, which alternatives were rejected, and what the acceptance checks are."
WhenToUse: "Before reading the diff of src/framework/ir/attribution.ts, src/typed/{attribute,missed,edit-classes}.ts."
---

# Design note: attribution, provenance and classification as queries

Phase 4, item 4.3, of the v7 refactor. Ticket IRWB-065-B. Read with the intern guide
(`ttmp/2026/11/28/IRWB-064--*/design-doc/01-*.md`, sections 2, 3) and the R3 synthesis's K2 row.

## 1. The problem, in one paragraph

Three tools explain what the optimizer did, and each holds a second account of facts the passes now
write down: D1 (`attributeSteps`, `src/typed/attribute.ts`) joins the statements of two revisions through
`origin[0].from` and names each group's decision from edit fields; D2 (`hotShapes`, `src/typed/missed.ts`)
labels a site's provenance by walking `origin.via`; A0 (`classifyApplication`, `src/typed/edit-classes.ts`)
recognises a rule-licensed rewrite by re-running the rule tables over the two value trees. Since phase 4.1 a
Typed `Tx` pass records a derivation per application (`by`, `consumes`, `produces`, `premises`, `relation`),
and since 4.2 the lowering's correspondence maps blocks to instructions. Two accounts of one fact can
disagree, and an explanation built from a second account is not evidence.

## 2. What this session builds

1. **One query module**, `src/framework/ir/attribution.ts`, next to `derivation.ts`: reads a chain of
   correspondences (and their derivations) and a weight per entity, and answers
   - `creditChain(links, weightsAt)`: per link, the groups of entities the link relates, each group's
     weight before and after the link, the derivation steps that name the group, and the entities of the
     chain's first revision its weight came from;
   - `changedBy(entities, links)`: per entity, the links at which it did not keep its identity, in chain
     order — provenance as a query.
2. **Three Typed adapters rewritten on it.** `src/typed/attribute.ts` keeps its signature (an input, a call,
   the emulator) and its format, and reads the join from each link's correspondence and the group's why from
   the derivation steps its edits cite. `src/typed/missed.ts` takes a site's provenance from `changedBy`
   over the whole chain instead of `origin.via`. `src/typed/edit-classes.ts` classifies a `replace` by the
   steps its edit cites (`locality` under the in-place policy), and reconstructs `local/rule`'s table and
   rules from those steps.
3. **One matcher.** `edit-classes.ts` no longer carries its own template instantiation or its own tree
   equality: `src/stdlib/term`'s `instantiate` (through a `Build` over `Tree`), `firstMatch`, `indexRules`
   and `structuralEqual` do that work. This is IRWB-060-B's port, written against the `terms.ts` API that
   exists on this branch (060-B's branch targeted `pattern.ts`/`rules.ts`, which do not).
4. **The 203-against-395 count settled** at A0's reading (section 5), in the query's test.

## 3. The input domain

Supported, and only this: a chain of revisions of one program where each link is a transformation that
published a correspondence (and, for Typed's `Tx` passes since 4.1, a derivation); weights are non-negative
numbers on entity ids of any revision of the chain; every entity that carries weight is named by the
correspondence of the link it belongs to. Weights may also sit on ids the revisions do not have (`frame`,
`backend` in D1): the query treats those as one-entity groups of their own. The programs are the corpus
projects and the calls that finish on every revision.

Not supported, and not given behaviour: a chain with a gap (a link whose `from` is not the previous
link's `to` — `creditChain` throws the correspondence module's own `IRError`), an entity with weight in a
revision it is not part of, negative weights.

## 4. Decisions, with the simplest alternative each rejects

**(a) Credit is per group of the correspondence, not per derivation step.**
*Alternative:* one row per `DerivationStep`, which is the purest K2 reading. It falls short because D1's
acceptance is exact reproduction and its rows are groups of statements with a weight on each side: a step
is not a place, three steps of one `mul-pow2` edit name three value nodes of one statement, and a statement
whose count changed with no step at all (`indirect`, the same statement compiled differently) has no row
under a step-shaped query. Groups let both rules live in one table: a group with steps, and a group with a
changed weight and no step.

**(b) The join is the correspondence, not `origin[0].from`.**
`groupOf` used `origin[0].from` — the first origin, and only when that statement exists in the revision
before. The correspondence is the same relation as a record the runner checked against the diff, and it is
relational where `origin[0]` is a single pointer: a step that consumed three statements and produced one
maps three, which is one group. Measured on the two acceptance runs (`various/d1-*-*.txt`): identical.

**(c) An entity's identity is carried by its own antecedent, not by the entry's name.**
`origin.via` says which pass made an entity; a correspondence entry can *name* a relation for an entity that
kept its identity — Typed's `inline` and `rotate` map unchanged entities with their own label, and the
correspondence records survival, not change (`derivation.ts`'s header says so). Provenance therefore asks
whether some entry of the link maps the entity to itself, not whether the entry's relation is `retained`.
Measured: 521 of 2,714 statements of D2's three programs differ if the entry's name is used alone, 4 if the
antecedent rule is added but the label is the entry's relation (an `inserted` entry has no relation to
name), 0 when a new entity is credited to its link's label.

**(d) The decision text of a D1 row still comes from the edit records.**
The query answers *which entities and which steps*; the label `<pass>: <kinds> (<note>)` is the edit
record's, because that is what the two IRWB-034-G tables print and the acceptance is exact. The derivation's
`by` and `premises` ride along on the row (unused by the current format) so a reader gets the rule, not just
the edit kind. *Alternative:* print `simplify: rule mul-pow2`, which is more faithful to K2 and would break
the tables; it is a formatting change for a later ticket.

**(e) Classification reads the steps its edit cites; `locality` is the query.**
`Application` gains the revision's records (derivation, correspondence). A `replace` is `local` when every
step the edit cites is `local` under the in-place policy, and `structural` otherwise; `local/rule` when a
cited step names a rule (its table and rule names come from the steps, and its weakest evidence from the
rule listing), `local/fact` when a cited step names a premise that is not a guard, `local/uncited` otherwise.
*Alternative:* keep `rederive` as the classifier. It re-derives the same answer from a second account and
disagrees with the records on the two `fold-add` edits.

**(f) `rederive` stays, as an audit, and is not what classifies.**
It is what checks that the derivation's rule names are rules the table would fire: without it, a pass could
cite a rule that never matches and every query would repeat the claim. It is now built on `src/stdlib/term`
so the audit is not a second template semantics. `tests/typed/rules.test.mjs` already used it that way
("one matcher, two readers").

## 5. Settling 203 against 395

A0's header defines `local` as a `replace` whose B "reads only locals the input revision already defines":
no local this application created and no local this application inserted a `set` for. That is a statement
about **locals** — variables and the statements that set them — and not about intermediate value nodes made
while rewriting one statement field, which the same header puts in one chain classified by its net change.

The `in-place` query admitted only the input revision's entities plus the values a `rebuild` step remade, so
two `fold` records (projects `constants` and `orders`) that fold a constant tree the same application
computed (`fold-add` over the product of `fold-shl`) answered `structural`: their premise is a value the
application made. Under the reading above the premise is not a local and the record is local. The ground the
in-place policy admits is therefore *the input revision's entities and the values this application computed*
(the values of the output revision that its steps produced); statements, blocks and locals the application
placed stay out, which is what keeps `licm` and `lvn` structural — every premise that makes them structural
is an `s:` the application inserted (`set`/`insert`), 83 and 14 of them. The count becomes 395: simplify
140, fold 43, strength 20, constprop 141, subst 51.

## 6. What remains, and why

| Kept | Why |
|---|---|
| `measureSites`' lowering + emulator loop | The query takes weights; producing them is the domain's half. The statement weights now come through the lowering's correspondence (`covered-by`), not through `covers` read by hand. |
| `origin` on entities (`from`, `via`, `because`, `note`) | Records of the producer, written by `Tx`; the correspondence is computed from the derivation, the derivation from those origins. Nothing in this lane rewrites the producer. |
| `rederive`/`normalize`/`sameTree` in `edit-classes.ts` | The audit of `local/rule` (section 4f) and the shape text of a rewrite no table re-derives (`div(get,#) -> shr(get,#)`), which is a description of two trees, not a re-derivation. `instantiate`/`handle`/`VERIFIED_TABLES`' own matcher is gone. |
| `instructionWeights`, `tallyInto`, `parts`, `shapeOf` | They attribute instructions to *edits* (A0's second output), which the derivations do not record: an edit's subtrees where A and B part. |

Deleted: `groupOf`'s `origin[0].from` walk (D1), `provenanceOf`'s `origin.via` walk (D2), A0's
`rederive`-based classification and its private tree handle/instantiate/normalize.

## 7. Acceptance

- `various/d1-before-*.txt` equals `various/d1-after-*.txt` (script `scripts/01-d1-tables.sh`);
- `various/d2-before-*.txt` equals `various/d2-after-*.txt` (script `scripts/03-d2-tables.sh`);
- the two policies as queries: 203 and **395**, with the reason in the test;
- the baselines print `no differences`; the five suites pass; `npm run check` is clean;
- `node tools/build-site.mjs` builds (the framework gained a module).

## 8. Later

- Print the derivation's `by` in D1's table (a formatting change to the IRWB-034-G tables).
- `src/framework/ir/index.ts` does not export the new module: that file belongs to lane 4.7, which removes
  modules from it. One line to add after the merge.
- `derivation.ts`'s doc for `locality`'s `input` parameter still describes the narrower ground; the caller
  now defines the ground, and its doc says what it is.
