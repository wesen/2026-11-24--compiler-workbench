---
Title: Final report
Ticket: IRWB-065-A
Status: active
Topics: [framework, derivation]
DocType: reference
---

# Report

Phase 4, item 4.3: the three explanation tools read the records the passes write instead of re-deriving the optimizer's decisions from IR trees and per-entity origins. One new framework module holds the two chain queries; the Typed tools become adapters over them; A0's two policies are queries over the cited derivation steps with the settled count; the last private copy of the rule matcher's template semantics is gone.

## What changed, file by file

- `src/framework/ir/attribution.ts` (new): the domain-independent chain queries. `creditLink` joins two revisions' sites through a link's recorded correspondence, distributes the two weight maps over the groups and aggregates the naming records; `provenanceLabels` says which link of a chain last changed an entity (an entry that maps an entity to itself means it survived, even when the entry also maps copies of it).
- `src/framework/ir/derivation.ts`: `inPlaceInput` next to `locality` — the settled in-place policy's input set (the input revision's entities, plus what the application's own rewrite chains only remade: rebuild and rule products).
- `src/typed/attribute.ts` (D1): `measureSites` pushes emulator counts onto statements through the lowering correspondence's `covered-by` entries; `stepRows` is `creditLink` plus the report formatting; a new site's note and reasons come from the derivation step that produced it (a link without a derivation falls back to the entry). The `origin[0].from` join and the `covers` scan are gone.
- `src/typed/missed.ts` (D2): the per-statement provenance label — the walk over `origin.via` of the statement and every value under it — is now `provenanceLabels` over a `chain` option (absent: all `ingest`, as at r0).
- `tools/missed.mjs`: passes the program's revision chain.
- `src/typed/edit-classes.ts` (A0): the class and sub-class of a `replace` are read off the derivation steps its chain cites (`locality` under the in-place policy; `rule`/`fact`/`uncited` from the steps' `by` and premises, with `firedRules` reconstructing firings as runs of rule steps sharing a site); the `placed`-locals walk, `reads` and the private `instantiate` are deleted; `normalize` builds through `stdlib/term`'s `instantiate` with a `Build` over plain trees (brief item 3, IRWB-060-B's move against this branch's `terms.ts` API); `rederive` survives as an **audit**.
- Tests: `tests/framework/attribution.test.mjs` (new, synthetic chains); `tests/typed/derivations.test.mjs` (395 settled with the justification, plus the audit test over the O2 corpus); `tests/typed/edit-classes.test.mjs` (derivation in `Application`; the no-derivation case pinned as `other/unrecorded`); `tests/typed/missed.test.mjs` (the chain option).

## The checks

- **D1's tables** (`scripts/01-attribution-tables.sh`, IRWB-034-G's two runs): byte-identical before and after (`various/attribution-{before,after}-{fib,checksum}.txt`).
- **D2** (`scripts/02-missed-benchmarks.sh`, the three programs IRWB-037-G ran it on): byte-identical (`various/06-missed-{regex,lz,chess-perft}-{before,after}.txt`).
- **Differential probe** (`scripts/06-differential.mjs`, old tools bundled from the pre-change commit, both run on the same revisions): **O2: 336 comparisons, 0 differences; speed: 510 comparisons, 0 differences** — D1, D2 and A0 outputs all byte-identical on every corpus program, both pipelines, inline revisions included.
- **A0's numbers**: scoped **203** and in-place **395**, both as queries over the same records, asserted in `tests/typed/derivations.test.mjs`.
- **Baselines**: `02-baselines.mjs check` prints **no differences**.
- **Suites**: typed 202 tests (200 pass, 2 pre-existing skips), framework 276 pass, workbench 25 (24 pass, 1 pre-existing skip), stdlib 67 pass, tensor without `*-gpu` 63 pass.
- `npm run check` clean; `node tools/build-site.mjs` builds (framework changed); the five changed `src/` files pass Prettier.

## 203 against 395, settled

The two counts disagree on exactly two `fold` records (`various/04-the-two-fold-records.txt`): `constants` and `orders`, each a chain in which `fold-shl`/`fold-mul` computes a constant and `fold-add`/`fold-sub` folds it, citing that constant as a premise — an entity the same application's rule chain made. A0's header defines `local` as a `replace` "where B reads only locals the input revision already defines: B reads no local this application created and no local this application inserted a `set` for", and classifies a chain by its net change; the premise is not a local but an intermediate of the chain. So A0 meant **395**, which is also what its tree-based classifier has answered all along. `inPlaceInput` encodes this: rule-chain intermediates are part of the chain; locals created, statements inserted and values made outside a rule chain (`licm`'s hoisted tree, `lvn`'s numbered value) are not — their premises cite the inserted statement, so they stay structural.

## What remains, and why (brief item 4)

Deleted: D1's `origin`-based join and `covers` scan; D2's `origin.via` walk; A0's `placed`-locals walk and `reads` (the second account of locality); A0's private template instantiation. Kept: `rederive`/`normalize` **as an audit** — a test now checks, over the whole O2 corpus, that what the tables re-derive is what the cited steps recorded (the audit's first run caught a real bug in my own `fired` list: a firing makes several steps); `treeOf`/`sameTree`/`parts`/`shapeOf`, which describe *what* changed for `instructionWeights` and the shape label, not why; the edit records as the decision labels' format, which the reproduction check pins.

## What I left out, and judgment calls

- **The derivation enters D1 through its correspondence.** `creditLink` reads the correspondence (which the runner computes from the derivation, and which the tests check equals the origin-based one); the per-entity words for new sites come from the producing steps. A whole-chain `creditThrough` over composed correspondences (the guide's sketch) was not needed: D1 measures every revision, so the walk is link by link.
- **`missed.ts` still reads `m.covers` for the site credit.** That is the lowering's own record (what `coverEntries` transcribes), not a re-derivation of pass decisions; the brief asks only for D2's *provenance*.
- **`derivation.ts` edited.** The brief's scope names "a query module next to derivation.ts"; `inPlaceInput` is the in-place policy's other half and belongs next to `locality`. Lane 4.7's brief forbids *that* lane from touching `derivation.ts`, which reads as this lane's to edit.
- **A replace citing no steps is `other/unrecorded`.** Unreachable for the built-in passes (every derived replace cites steps; `inline` records no replaces); stated rather than silently re-deriving.
- **The entry fallback for links without a derivation** can aggregate a group's notes; `scripts/07-inline-coverage.mjs` shows it is unreachable on the corpus (inline never names a new site with its edit records), so D1's output is exact everywhere the tools run.

The probe `06-differential.mjs` bundles "HEAD" — re-run against the pre-change commit (`da32a78`), not a later one.
