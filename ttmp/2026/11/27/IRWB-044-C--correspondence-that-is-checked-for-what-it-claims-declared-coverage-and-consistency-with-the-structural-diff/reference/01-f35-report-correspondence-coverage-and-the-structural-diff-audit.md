---
Title: "F35 report: correspondence coverage and the structural-diff audit"
Ticket: IRWB-044-C
Status: active
Topics:
    - framework
    - contracts
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T00:00:00-05:00
WhatFor: ""
WhenToUse: ""
---

# F35 report

Design: `design-doc/01-f35-correspondence-coverage-and-consistency-with-the-structural-diff.md`.
Diary: `diary.md`. Probes: `scripts/01` (what the diff says), `scripts/02` (do the existing
correspondences cover both universes), `scripts/03` (the two checks, separated).

## What changed, file by file

- `src/framework/ir/diff.ts` — new `EntityPresence` and `entityPresence(before, after)` (`inserted` /
  `removed` / `kept`); `diffGraphs` now classifies its entity changes through it, with the same output
  and the same order.
- `src/framework/contracts/types.ts` — `CorrespondenceCoverage` (`partial` | `sourceTotal` |
  `targetTotal` | `bothTotal`) and `CorrespondenceRequirement.coverage`.
- `src/framework/contracts/definitions.ts` — `DEFAULT_CORRESPONDENCE_COVERAGE = 'bothTotal'`; every
  requirement is validated and stored with an explicit coverage, so a definition states what it demands.
- `src/framework/contracts/analysis-manager.ts` — `entityUniverse` (the type's `entities(value)`, else the
  record's list); the entity-list check now also rejects entry IDs outside a *declared* universe;
  `auditCorrespondenceContent` (coverage per declared policy; the deletion rule over
  `entityPresence`; same-kind only); the requirement loop passes the requirement, the transfer path
  (`preserve`) is unchanged.
- `src/tensor/cuda-contract.ts` — the one cross-kind requirement (`kernels`) now declares
  `coverage: 'partial'`, with the reason in a comment.
- `src/framework/contracts/README.md` — the requirement line and the correspondence section state the two
  checks.
- `tests/framework/r3-defects.test.mjs` — the `todo` on "F35: zero mapping groups and a false group are
  rejected; the honest mapping is accepted" is removed. No assertion touched.
- `tests/framework/correspondence-coverage.test.mjs` (new) — the vocabulary and the default; `sourceTotal`
  and `targetTotal`; the audit alone under `partial`; the cross-kind boundary; a type that enumerates
  nothing; an unknown policy rejected at definition time.

## Acceptance

| Check | Result |
| --- | --- |
| `tests/framework/r3-defects.test.mjs` F35 | passes, no `todo` (`pass 1, todo 3` — F33/F34 remain other steps') |
| `02-baselines.mjs check` after `npm run build` | `no differences from .../various/baselines/main.json` |
| `tests/framework/*.test.mjs` | 248 tests, 245 pass, 0 fail, 3 todo |
| `tests/typed/*.test.mjs` | 188 tests, 183 pass, 0 fail, 2 skipped, 3 todo |
| `tests/workbench/*.test.mjs` | 25 tests, 24 pass, 0 fail, 1 skipped |
| `tests/tensor/*.test.mjs` minus `*-gpu` (7 files) | 45 tests, 44 pass, 0 fail, 1 todo |
| `npm run check` | clean |
| `node tools/build-site.mjs` | builds (`dist/site built in 463 ms`) |
| `npx prettier --check` on the five changed source files | clean (the 9 files `format:check` still lists were unformatted before this step and are untouched) |

## The design decisions, briefly

**Coverage vocabulary and default.** `partial` / `sourceTotal` / `targetTotal` / `bothTotal`, default
`bothTotal`. `ir/correspondence.ts` already requires an `EntityCorrespondence` to account for every source
and target entity; the contract layer accepted less than the layer below it, and the R3 probe-04 program
shows the difference: its contract-level universes are `['f/p','f/y'] → ['f/y']`, so the honest group
covers both and a zero-group record covers neither. All five existing requirements are total on both sides
(four lab requirements build the record with `makeCorrespondence`; the tensor lowering was measured on the
whole corpus in `scripts/02`: 0 unmapped sources, 0 unmapped targets, fused and unfused).

**What each existing requirement declares.** `ir-lab.expression.transform`, `ir-lab.scene.transform`,
`ir-lab.mesh.transform`, `ir-lab.constraints.transform`: `bothTotal` (the default; their IR types do not
enumerate, so their universes are the declared lists). `tensor.lower-cuda` `kernels`: `partial`, written
out — see the disagreement below. There is no correspondence requirement in `src/typed/`, so nothing to
declare there.

**The consistency rule.** One rule, from the structural diff's presence classification: a group with an
empty target claims its source entities have no counterpart after the change, so it may not name an entity
the diff keeps (present in both revisions, unchanged or updated). The mirror form — a group with an empty
source naming a kept target, "claims a creation" — is *not* rejected: the framework's own
`makeCorrespondence` emits precisely that form, with relation `unmapped-origin`, for a kept target that a
caller's explicit entries did not map, so emptiness on the source side means "no origin stated", not "new".
Making surviving entities be mapped is the coverage policy's job. `scripts/03` shows the rule standing on
its own: with `coverage: 'partial'`, zero groups and the honest group are accepted and
`{f/y} → []` is rejected with "Correspondence maps f/y to nothing; the structural diff keeps it".

**Where the audit runs.** Only for a correspondence a transformation requirement asks for, and only when
both ports have the same IR kind and schema version: across two kinds (Tix → CUDA) entity presence is not
a diff of one IR. `preserve`/transfer correspondences keep their old validation — several existing ones are
listless permutations by design (`tests/framework/contracts.test.mjs`), and a transfer is justified by its
analysis's executable rule.

**Coverage when nothing enumerates.** If neither the IR type nor the record states a universe, there is
nothing to cover and coverage is not applied, as the entity-list check has always been gated on
`type.entities`. My first version *refused* such a record as unverifiable; that rejected the transfer
fixture above and four lab transformations whose bridge correspondences declare no lists, i.e. it changed
behaviour the framework documents as "self-declared". I backed it out and the tests decided it.

## Where I disagree with the brief or the tests

1. **`tests/tensor/cuda.test.mjs`, "concurrent lowering checks share a batch…"** verifies a *candidate* CUDA
   unit built with `cudaArtifact('f', 'different CUDA source')`, which carries an empty kernel inventory,
   and asserts the rejection reason is the differential verdict (`/At \[0\], expected/`). With `bothTotal`
   on the `kernels` requirement, the correspondence audit rejects that candidate first
   ("does not cover source entities: f/y"), which is cheaper and, arguably, true. I did not change the
   test's assertion: the lowering requirement declares `partial` instead. The consequence is that the real
   lowering's totality (measured in `scripts/02`) is a property of the domain, not something the contract
   holds a candidate to.
2. **The framework's layering.** The audit needs the diff's notion of what happened, and the contracts layer
   is handed `IRType`s, not `IRGraph`s, so the rule can only be stated over entity presence. I put
   `entityPresence` in `ir/diff.ts` and had `contracts` import it, so there is one definition and
   `diffGraphs` is its second user. That adds the first `contracts → ir` edge in the framework; it does not
   break `tests/framework/layering.test.mjs` (which constrains imports *from core*) and there is no cycle,
   but it does weaken the "contracts is separable" reading. The alternative — a five-line copy inside the
   manager — keeps the edge out and duplicates the classification in the layer that audits it.
3. **A definition's schema changes.** Requirements now carry an explicit `coverage`, so
   `describeDefinition` output (and therefore registry manifests and transformation cache keys) contains
   one more field for a transformation that requires a correspondence. No test or baseline depends on it,
   and it is what makes "what does this requirement declare" answerable from the definition.
4. **Entry IDs against a declared universe.** With this change, a record whose IR type does not enumerate
   but whose declared list does is *also* checked for entries naming unknown IDs. That is stricter than
   before (there, a non-enumerating type skipped the check entirely) and it is what made a declared list a
   trustworthy universe. No existing caller is affected.

## Left out

- No relation-level audit: `relation` is a free-form string and the contract-level record does not attach
  one to each group, so "a group that says an entity was retained" cannot be checked against an `updated`
  classification.
- The `preserve`/transfer correspondence is not audited (see above).
- `src/labs/` was not touched: those four requirements keep the default, which states their meaning.
- No `*-gpu` test was run (no GPU here), and `npm test` was not run (shared machine).

## Commits

| Commit | Content |
| --- | --- |
| `6995661` | design, ticket, probes 01 and 02 |
| `9a78b34` | implementation and the un-todoed F35 test |
| `02ac33a` | contracts README, prettier on `definitions.ts` |
| `12d0580` | diary, changelog, tasks, this report |
| `c3e655a` and the commit after it | ticket markdown only (`git diff --stat 02ac33a HEAD -- src tests` is empty) |

Every acceptance check above was run on the code of `02ac33a`, which is byte-identical to the code of the
last commit (`git diff --stat 02ac33a HEAD -- src tests` prints nothing); the last commit only changes this
ticket's markdown.
