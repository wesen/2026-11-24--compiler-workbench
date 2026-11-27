---
Title: Coverage vocabulary, the default, and the consistency rule
Ticket: IRWB-044-B
Status: active
Topics:
    - framework
    - contracts
    - correspondence
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T18:40:24.240143057-05:00
WhatFor: ""
WhenToUse: ""
---

# Coverage vocabulary, the default, and the consistency rule

## Executive Summary

<!-- Provide a high-level overview of the design proposal -->

## Problem Statement

<!-- Describe the problem this design addresses -->

## Proposed Solution

<!-- Describe the proposed solution in detail -->

## Design Decisions

<!-- Document key design decisions and rationale -->

## Alternatives Considered

<!-- List alternative approaches that were considered and why they were rejected -->

## Implementation Plan

<!-- Outline the steps to implement this design -->

## Open Questions

<!-- List any unresolved questions or concerns -->

## References

<!-- Link to related documents, RFCs, or external resources -->

## The gap (BACKLOG F35, R3 probe 04)

A transformation contract's `correspondence` requirement names an entity mapping between its input and
output revisions. The manager validates such a record (`validateCorrespondence`, `analysis-manager.ts`)
only for *membership*: the declared endpoint lists must equal the IR's actual entities (on IR types that
enumerate them), and every group entry must name known entities. It never checks that the groups cover
anything, or that they agree with what actually changed. So a record with complete endpoint lists and
zero mapping groups is accepted, and so is a group that maps a surviving entity to nothing.

## Coverage vocabulary

A `CorrespondenceRequirement` declares what its mapping must cover, as `coverage`:

- `'partial'` — no coverage requirement; groups may cover any subset.
- `'sourceTotal'` — every source entity of the record must appear in some group's `from`.
- `'targetTotal'` — every target entity must appear in some group's `to`.
- `'bothTotal'` — both of the above.

Coverage is judged against the record's own `sourceEntities`/`targetEntities` lists, which the existing
membership check has already forced to equal the IR's actual entities on enumerated types (and which are
all there is on non-enumerated types — the boundary F23/IRWB-031 chose, kept here).

**Default: `'bothTotal'`.** Rationale: every framework path that builds a correspondence record goes
through `makeCorrespondence` (`ir/correspondence.ts`), whose own validation already requires every
source and target entity to be accounted for — so every existing record already satisfies `'bothTotal'`,
and a weaker default (`'partial'`, or one-sided) would keep accepting the zero-group record the probe
shows is vacuous. The default is also what a reader of "requires an entity correspondence" naturally
means: the mapping claims to say where everything went.

**What each existing requirement now declares:**

| Requirement | Declares | Why it passes |
| --- | --- | --- |
| `src/labs/contracts.ts` — 4 × `entities` (`generic-ir-edit`) | `'bothTotal'` (default) | records come from `makeCorrespondence` (directly, composed, or identity), which accounts for every entity on both sides |
| `src/tensor/cuda-contract.ts` — `kernels` (`statements-to-kernels`) | `coverage: 'targetTotal'` | the baseline is the whole module, but a lowering maps only the lowered function's statements to kernels; its claim is that every kernel is accounted for, not that every statement of every function is consumed |
| tests' ad-hoc requirements (`correspondence-entities`, `cuda.test.mjs` kernel inventory, the F35 test's `mappingOnly`) | `'bothTotal'` (default) | their records are `makeCorrespondence`/`kernelCorrespondence` products that cover both sides (or, on non-enumerated types, declare empty universes) |

Typed's optimization contracts declare no correspondence requirement, so no coverage check applies there.

## Consistency with the structural diff

The structural diff (`ir/diff.ts`, `diffGraphs`) classifies each entity id between two revisions as
`inserted` (target only), `removed` (source only), or `unchanged`/`updated` (in both graphs; content
equality separates the last two). The manager sits in the contracts layer, which deliberately sees IRs
only through `IRType.entities` (id universes), not adapters; but at the id level the diff's
classification is exactly the two universes' set difference, and the membership check has already
pinned the record's lists to those universes. So the manager can audit the declared groups against the
same fact the diff states, computed as a set operation:

**Rule:** a group with a non-empty `from` and an empty `to` claims its source entities were removed.
Every id in that `from` must be absent from the target universe. An id present in both universes is one
the diff shows unchanged or updated — it survives, so mapping it to nothing contradicts the revision it
claims to describe, and the manager rejects the record.

The rule is deliberately one direction only. A group with an empty `from` (an insertion claim) naming
an id that also exists in the source is *not* rejected: `makeCorrespondence` itself produces such
entries (`relation: 'unmapped-origin'`) when a pass consumes an id and a new entity reuses the same
name — the diff's id-level classification cannot distinguish name reuse from survival, so rejecting it
would forbid records the IR layer's own correspondence builder legitimately emits.

The check lives in `validateCorrespondence`, so it covers both a contract's correspondence requirements
and the records used to justify analysis transfer (`manager.preserve`).

## Rejected alternatives

- *Default `'partial'`: * smaller change, but it is the status quo the probe indicts — the zero-group
  record stays accepted — and it forces every honest requirement to opt in to be checked at all.
- *Coverage checked inside `makeCorrespondence` only: * the IR layer can see one record, but not the
  requirement that demands it; the manager is where the contract's claim meets the evidence, and where
  a rejection is recorded as a rejected execution.
- *Full `diffGraphs` in the manager: * would need adapters in the contracts layer, a dependency the
  layer does not have; for the stated rule ("unchanged or updated cannot be mapped to nothing") the
  id-level classification adds nothing, since it treats unchanged and updated identically and the
  content comparison lives behind that boundary.

## Tests

- `tests/framework/r3-defects.test.mjs` F35 test (probe 04 as a test of correct behaviour): zero
  groups rejected; the false "y was deleted" group rejected; the honest p,y → y mapping accepted.
- `tests/framework/correspondence-entities.test.mjs` keeps passing: enumerated and non-enumerated
  fixtures, and the direct-record entry checks.
