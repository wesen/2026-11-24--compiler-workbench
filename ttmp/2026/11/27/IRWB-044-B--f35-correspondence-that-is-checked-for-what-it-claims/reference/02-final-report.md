---
Title: Final report
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
LastUpdated: 2026-11-27T19:05:59.932877113-05:00
WhatFor: ""
WhenToUse: ""
---

# Final report

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

## What changed

A correspondence requirement now declares what its mapping must cover, and every record the manager
validates is checked against what the two revisions actually show.

- `src/framework/contracts/types.ts` — `CorrespondenceCoverage`
  (`'partial' | 'sourceTotal' | 'targetTotal' | 'bothTotal'`) and an optional `coverage` on
  `CorrespondenceRequirement`, defaulting to `'bothTotal'`.
- `src/framework/contracts/definitions.ts` — `defineTransformation` rejects an unknown coverage word.
- `src/framework/contracts/analysis-manager.ts` — **coverage**: the transaction `verify` rejects a
  record whose mapping groups leave entities uncovered that the requirement's `coverage` claims
  (default: every source and every target entity). **consistency**: `validateCorrespondence` rejects a
  group that maps an entity surviving in the target (one the structural diff shows unchanged or
  updated) to nothing; this applies to contract requirements and to `manager.preserve` transfer
  justifications alike.
- `src/tensor/cuda-contract.ts` — the `kernels` requirement declares `coverage: 'targetTotal'`: the
  baseline is the whole module while the lowering maps only the lowered function's statements to
  kernels; its claim is that every kernel is accounted for.
- `tests/framework/r3-defects.test.mjs` — the F35 `todo` removed in the same commit as the fix.
- Ticket `scripts/01-coverage-and-consistency.mjs` — the probe: every rejection and acceptance case,
  including why `kernels` is `targetTotal` (a two-function baseline under `bothTotal` is rejected).

## What each existing requirement now declares

| Requirement | Declares |
| --- | --- |
| `src/labs/contracts.ts` — 4 × `entities` (`generic-ir-edit`) | `'bothTotal'` (the default) |
| `src/tensor/cuda-contract.ts` — `kernels` (`statements-to-kernels`) | `'targetTotal'` |
| tests' ad-hoc requirements (`correspondence-entities`, `cuda.test.mjs`, the F35 test) | `'bothTotal'` (the default) |

Typed's optimization contracts declare no correspondence requirement; nothing changes for them.

## Evidence

- `tests/framework/r3-defects.test.mjs` — the F35 test passes (zero groups and the false group are
  rejected; the honest `p,y → y` mapping is accepted).
- Baselines: `node ttmp/2026/11/27/IRWB-039--.../scripts/02-baselines.mjs check` prints `no differences`.
- Suites (all four, non-GPU): 500 tests, 490 pass, 0 fail, 3 skipped, 7 todo (F27, F33 ×2, F34, F36,
  F37, F38 — the todo tests of other steps).
- `npm run check` clean; `node tools/build-site.mjs` builds.

## Scope notes and left out

- The consistency rule is deliberately one direction: mapped-to-nothing must not name a surviving
  entity. A group with an empty `from` that names an id also present in the source is *not* rejected:
  `makeCorrespondence` itself emits such entries (`relation: 'unmapped-origin'`) when a pass consumes
  an id and a new entity reuses the name, and the id-level classification cannot distinguish name reuse
  from survival. Rejecting them would forbid records the IR layer's own builder produces; it is left
  for a rule with content-level diff information.
- The manager computes the diff's id-level classification (source-only = removed, target-only =
  inserted, in both = unchanged-or-updated) from the entity universes the membership check already
  pins to the artifacts. A full `diffGraphs` call would need adapters in the contracts layer, a
  dependency the layer does not have, and the stated rule treats unchanged and updated identically.
- No brief or test assertion was found wrong.
