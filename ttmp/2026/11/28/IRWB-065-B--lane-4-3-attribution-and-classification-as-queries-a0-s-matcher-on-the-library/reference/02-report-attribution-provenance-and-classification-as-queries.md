---
Title: 'Report: attribution, provenance and classification as queries (lane 4.3, IRWB-065-B)'
Ticket: IRWB-065-B
Status: active
Topics:
    - framework
    - derivation
    - ir
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Phase 4 item 4.3 done: one framework query module over a chain of correspondence-and-derivation records, D1, D2 and A0 rewritten on it, A0's matcher on src/stdlib/term, the re-derivation code deleted, the 203/395 count settled at 395, and the acceptance runs."
LastUpdated: 2026-11-28T00:00:00-05:00
WhatFor: "The result of lane 4.3 for the coordinator, and the record of what the queries replace."
WhenToUse: "When merging IRWB-065-B, or when extending attribution, provenance or classification."
---

# Report: attribution, provenance and classification as queries

Lane 4.3 of v7 phase 4 (ticket IRWB-065, cell B). Design note:
`design-doc/01-design-note-*.md`. Diary: `reference/01-diary.md`. Acceptance transcript:
`various/acceptance.txt`, with the tables themselves in `various/d1-*.txt` and `various/d2-*.txt`.

## 1. Result

Three tools that explained the optimizer by re-deriving its work from IR trees now read the records the
passes write: one framework query over a chain of correspondences and derivations, and three thin domain
adapters on it. The two acceptance tables reproduce byte for byte, the two A0 policies are queries over the
same records and agree with each other at 203 (scoped) and **395** (in-place), and the domain's last copy of
a rule matcher is on `src/stdlib/term`.

## 2. What changed, file by file

| File | Change |
|---|---|
| `src/framework/ir/attribution.ts` (new, 375 lines) | `recordChain(links)` indexes a chain of `{ label, correspondence, derivation }` once and answers two questions. `credit(weightsAt, { entities })`: per link, the **groups** — connected components of the correspondence — with each group's weight on both sides, `delta`, the derivation steps that name it (`steps`, `by`, `premises`), the entries' `relations`, `because`, `notes`, and `sources` (the entities of the chain's first revision the weight traces back to). `changedBy(entities)`: the label of the link that made each entity of the last revision. Two identity rules: an entry that maps an entity to itself is survival, not change; an entity that did not survive was made by its link, so the link's label names it. |
| `src/typed/attribute.ts` | D1 as an adapter: same signature, same `Attribution` shape, same text format. The join of two revisions is `credit`; the per-site weights reach the statements through the lowering's correspondence (`covered-by`) instead of reading the image's `covers`; the why is the cited steps of the edits that name the group (`AttributionRow.by`, new) and the premises of the step that made a new statement; the `because` column is the edits' plus those premises. `measureSites`, the emulator call and the formatting are unchanged in behaviour. |
| `src/typed/missed.ts` | D2's provenance is `recordChain(chain).changedBy(statement and its values)` instead of the `origin.via` walk; the site's instruction and value ids now come from the lowering's correspondence. `hotShapes` takes `options.chain` and **refuses** a head revision above r0 without one, so no caller silently gets `ingest` for everything. |
| `src/typed/edit-classes.ts` | Classification of a `replace` reads `Edit.steps`: all cited steps `local` under the in-place policy → `local` (`rule` / `fact` / `uncited`, with `RuleMatch` rebuilt from the steps and the rule listing), otherwise `structural/motion`; an application that recorded no derivation answers `other/unrecorded`. New `localityGround(before, after, source?, made?)` — one ground, shared with the step-level query. `sameTree` is the library's `structuralEqual` over a tree signature; `normalize` instantiates through the library's `instantiate` with a `Build` over `Tree`. Deleted: the private `instantiate`/`treeBound`/`replace` matcher copy, the `placed`/`reads` tree test for "B reads a local this application placed", and the `origin.because` read for `local/fact`. `rederive` survives as the audit of `local/rule` and says so in the header. |
| `tools/missed.mjs` | passes the chain (`p.revisions.slice(1)`) to `hotShapes`. |
| `tests/framework/attribution.test.mjs` (new) | the module on a synthetic two-link chain: components, weights and their distribution, `frame`-style ids, caller-named entities, `sources`, `changedBy` with self-mappings, a chain gap refused. |
| `tests/typed/attribute.test.mjs` | +1 test: a rule-licensed row names its rule (`simplify/mul-pow2`), every row of a recording pass names something from the records. |
| `tests/typed/missed.test.mjs` | passes the chain; +1 test: a chainless head above r0 is refused. |
| `tests/typed/edit-classes.test.mjs` | passes the records to `classifyApplication`; +1 test: the O2 corpus, classified, 1,774 records and 395 local edits (constprop 141, simplify 140, subst 51, fold 43, strength 20). |
| `tests/typed/derivations.test.mjs` | the in-place policy's ground is `localityGround` (one source with the classifier); the settled numbers are 203 and **395**, with the reason in the test. |

## 3. Decisions

The design note records six, each with the simpler alternative it rejects. The three that matter when
reviewing:

1. **Credit is per group of the correspondence, not per derivation step.** A step is not a place: three steps
   of one `mul-pow2` edit name three value nodes of one statement, and a statement whose count changed with
   no step (`indirect`) has no row under a step-shaped query. Groups hold both.
2. **Classification reads the steps; `rederive` is the audit.** Without an audit, a pass could cite a rule
   that never matches and every query would repeat the claim; with the audit, the two readers of the rule
   tables stay one matcher, which is now the library's.
3. **The 203/395 count is 395.** A0's header defines `local` as a `replace` whose B "reads only locals the
   input revision already defines" — a statement about **locals**, not about intermediate value nodes. The
   two records IRWB-056-B read as structural (`fold-add` folding a tree the same application's `fold-shl`
   computed, on `constants` and `orders`) name a value, not a local. Every premise that makes `licm` (83) and
   `lvn` (14) structural is a statement the application inserted, so the ground is "the input revision and
   the values this application computed", which is `localityGround`. Evidence: `scripts/02-premises.mjs`.

## 4. Acceptance

| Check | Result |
|---|---|
| D1's tables reproduce | `various/d1-before-fib.txt` == `d1-after-fib.txt` (151 lines), checksum 173 lines; `cmp` identical |
| D2's hot shapes unchanged | `various/d2-before-{regex,lz,chess}.txt` == `d2-after-*.txt` |
| Both A0 policies as queries, numbers settled | 203 (scoped) and 395 (in-place) in `tests/typed/derivations.test.mjs`; 395 in `classifyApplication` over the O2 corpus (`tests/typed/edit-classes.test.mjs`, `scripts/09-o2-classify.mjs`) |
| Baselines | `02-baselines.mjs check`: `no differences` |
| Suites | typed 201/0, framework 279/0, workbench 24/0, stdlib 67/0, tensor (no `*-gpu`) 63/0 — pass/fail |
| `npm run check` | clean; `node tools/build-site.mjs` builds (the framework gained a module) |
| Prettier | the four changed `src/` files pass `prettier --check`; the six files that fail `npm run format:check` were unformatted before this ticket |

## 5. What remains, and why

| Kept | Why |
|---|---|
| The lowering + emulator in `attribute.ts`, the lowering + run in `missed.ts` | The query takes weights; producing them is the domain's half. |
| `origin` on entities | The producer's record: the derivation is written from it, the correspondence from the derivation. |
| `rederive` / `normalize` / `VERIFIED_TABLES` in `edit-classes.ts` | The audit of `local/rule` (`tests/typed/rules.test.mjs`'s "one matcher, two readers"), now on the library. |
| `parts`, `shapeOf`, `instructionWeights`, `tallyInto` | They attribute instructions to *edits* (the subtrees where A and B part), which the derivations do not record. |
| `Edit.steps`-based `by` in `attribute.ts` | A step that made a value inside the statement the weight is attached to names a value, not the statement; the edit record is what ties them. |

Deleted: `groupOf`'s `origin[0].from` walk, D2's `origin.via` walk, A0's `rederive`-based classification, the
`placed`/`reads` tree test, and the file's own `instantiate`.

## 6. Left out, and what I believe is wrong or open

- **`src/framework/ir/index.ts` does not export the new module.** That file is lane 4.7's (it removes
  `patterns`, `rewrites`, `traversal`, `transactions` from it). After both lanes merge, one line:
  `export * from './attribution.js';`. Importers use the path meanwhile.
- **`derivation.ts`'s doc for `locality`'s `input` parameter** still describes the narrower ground ("whatever
  the producer only remade from them"). The caller now defines the ground (`localityGround`, documented
  there). I did not edit `derivation.ts`: it is outside this lane's scope, and 4.7 lists it as untouchable.
  One sentence to update at merge.
- **D1's decision text is still the edit records'**, not the derivation's (`simplify: replace`, not
  `simplify: rule mul-pow2`). Reproducing the IRWB-034-G tables exactly requires the former; the row now
  carries `by` for a reader who wants the rule. Changing the printed column is a formatting ticket.
- **`other/unrecorded`** is a new `sub` value for an application that recorded no derivation. Only Typed's
  `inline` is such a pass and its edits are caught earlier as `structural/inline`, so the corpus has none; it
  is a guard, not a class in the tally.
- **The labelled `because` column is narrower than the query's.** `Credit.because` is every entry's reasons
  (i.e. a statement's and its values'); the table's column is the statement's. The table needs the latter,
  which is why the adapter reads the premises of the step that produced a new statement.
- **One numeric check I did not make**: the group order inside a step is a global sort (`rev`, `delta`, first
  site) where the old code sorted within a step. The two tables agree; a third program might expose a
  difference. It is a sort of the same keys, and rows of one revision cannot interleave.

## 7. Second pair of eyes

1. `changedBy`'s stop rule (it stops at the link that made an entity; following the antecedent gave 521
   differences on D2's three programs, stopping gives 0) and the `existsAt` guard for entities a revision
   does not have.
2. `localityGround`'s `made` parameter: it is what makes the two `fold-add` records local, because the value
   they cite is in neither revision. `scripts/02-premises.mjs` is the evidence.
3. `recordChain`'s memo (`${revision}:${entity}`), shared across `changedBy` calls: the answer depends only on
   the entity and the revision.
