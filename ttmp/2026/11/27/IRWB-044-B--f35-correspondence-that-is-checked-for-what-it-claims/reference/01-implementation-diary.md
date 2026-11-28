---
Title: Implementation diary
Ticket: IRWB-044-B
Status: active
Topics:
    - framework
    - contracts
    - correspondence
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T19:05:46.601094476-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Goal

<!-- What is the purpose of this reference document? -->

## Context

<!-- Provide background context needed to use this reference -->

## Quick Reference

<!-- Provide copy/paste-ready content, API contracts, or quick-look tables -->

## Usage Examples

<!-- Show how to use this reference in practice -->

## Related

<!-- Link to related documents or resources -->

## 1. Orientation

The step is BACKLOG F35: the manager validates a correspondence record only for membership (declared
endpoint lists equal the IR's entities; entries name known entities), never for coverage or consistency
with what actually changed. Read the R3 probe (`IRWB-019 .../various/r3-synthesis/scripts/04-correspondence-content.mjs`),
the todo test in `tests/framework/r3-defects.test.mjs`, the v7 design doc's F35 row (which names the
vocabulary `partial/sourceTotal/targetTotal/bothTotal`), and `validateCorrespondence`
(`analysis-manager.ts`), `diffGraphs` (`ir/diff.ts`), `makeCorrespondence` (`ir/correspondence.ts`).

Key discovery while surveying existing requirements: `kernelCorrespondence` lists the *whole module's*
statements as source entities, but its groups cover only the lowered function's statements — so the CUDA
`kernels` requirement cannot default to `bothTotal` (a two-function baseline would leave the other
function's statements uncovered); it declares `targetTotal`. Everything else (labs' four `entities`
requirements, the tests' ad-hoc requirements) is fed by `makeCorrespondence` products, which already
account for every entity on both sides — so `bothTotal` is the safe default.

## 2. Design

Written to the ticket's `design-doc/01-...md` and committed first (e68ee71). Vocabulary
`partial | sourceTotal | targetTotal | bothTotal` on `CorrespondenceRequirement.coverage`, default
`bothTotal`; consistency rule one direction only (mapped-to-nothing must name no surviving entity),
because `makeCorrespondence` itself emits `unmapped-origin` entries (`from: []` for an id that exists in
the source) when a consumed id is reused by a new entity, and the id-level diff cannot distinguish name
reuse from survival.

## 3. Implementation

- `contracts/types.ts`: `CorrespondenceCoverage` and `coverage?` on `CorrespondenceRequirement`.
- `contracts/definitions.ts`: reject an unknown coverage word at definition time.
- `contracts/analysis-manager.ts`: the consistency check in `validateCorrespondence` (so contract
  requirements *and* `manager.preserve` transfer justifications get it), and the coverage check in the
  transaction `verify` requirement loop, after `validateCorrespondence` and the relation check (so
  `cuda.test.mjs`'s `/entity mismatch/` assertions still hit the membership error first).
- `tensor/cuda-contract.ts`: `kernels` requirement declares `coverage: 'targetTotal'`.
- `tests/framework/r3-defects.test.mjs`: removed the F35 `todo`.

One edit to the requirement loop came out garbled (a stray backtick); rewrote the block cleanly before
building.

## 4. Validation

- `npm run build` and `npm run check` clean.
- `node --test tests/framework/r3-defects.test.mjs`: the F35 test passes; F27/F33/F34/F36–F38 remain
  todo tests of other steps (no EPERM; no escalation needed anywhere).
- Baselines (`IRWB-039` `scripts/02-baselines.mjs check`): `no differences`.
- The four non-GPU suites (70 files): 500 tests, 490 pass, 0 fail, 3 skipped, 7 todo (F27, F33 ×2,
  F34, F36, F37, F38 — other steps).
- `npm run format:check`: the 9 files it warns about are pre-existing and untouched by this step; all
  four changed `src/` files pass.
- `node tools/build-site.mjs`: builds (50 projects, 17 chapters).
- Ticket probe `scripts/01-coverage-and-consistency.mjs`: honest group accepted; zero groups and the
  false "y was deleted" group rejected; `partial` asks nothing; an invalid coverage word is rejected at
  definition time; the CUDA lowering still accepted; the same record under `bothTotal` on a
  two-function baseline is rejected (why the lowering declares `targetTotal`).
