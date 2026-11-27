---
Title: "F35: correspondence coverage and consistency with the structural diff"
Ticket: IRWB-044-C
Status: active
Topics:
    - framework
    - contracts
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T00:00:00-05:00
WhatFor: ""
WhenToUse: ""
---

# F35: correspondence coverage and consistency with the structural diff

## The defect

A transformation can require an entity correspondence between an input and an output port
(`TransformationDefinition.correspondence`, `src/framework/contracts/types.ts`). The manager
(`AnalysisManager.validateCorrespondence`, `src/framework/contracts/analysis-manager.ts:1087`) checks
three things: the record names the exact input/output revisions, the entries are string lists, and the
record's `sourceEntities`/`targetEntities` lists equal the IR's own entities (`IRType.entities`).

Nothing is checked about the *entries*. Two records therefore reach `accepted`:

1. complete endpoint lists with zero mapping groups — the correspondence says nothing at all;
2. a group that names a surviving entity and maps it to nothing — the correspondence says an entity
   that is still there was deleted.

`ttmp/2026/11/26/IRWB-019-.../various/r3-synthesis/scripts/04-correspondence-content.mjs` shows both,
and `tests/framework/r3-defects.test.mjs` ("F35") states them as the expected behaviour.

## Supported input domain

The new checks apply to a correspondence that a *transformation requirement* asks for
(`definition.correspondence`), as verified by `verifyTransformation`/`execute`/`applyPass`. Within that
domain:

- an entity universe is known for a port when its `IRType` declares `entities(value)` (then the record's
  list must equal it, as today) or, failing that, when the record declares the list itself (`SceneIR`,
  `MeshIR` and the other labs IR types do not enumerate; their correspondences come from
  `makeCorrespondence`, which always lists both universes);
- correspondence content is compared only when both ports have the same IR kind and schema version:
  a Tix→CUDA lowering maps two different entity universes, and the entity presence of one is not the
  entity presence of the other.

Correspondences given to `manager.preserve(...)` (analysis transfer) are outside the domain: they are
justified by the transfer rule's own verdict, and several existing ones (`tests/framework/contracts.test.mjs`)
are listless permutations by design.

## 1. Coverage: what the mapping must cover

`CorrespondenceRequirement` gains one optional field, a policy from a fixed vocabulary:

| `coverage` | the entries must name |
| --- | --- |
| `partial` | nothing beyond the per-entry checks below |
| `sourceTotal` | every entity of the source universe |
| `targetTotal` | every entity of the target universe |
| `bothTotal` (default) | every entity of both universes |

"Name" means appear in some entry's `from` (source side) respectively `to` (target side), whatever the
entry's relation. The manager rejects a mapping whose named entities do not cover the declared side with
`ContractError('correspondence', 'Correspondence does not cover ...: <ids>')`. When a side must be total
but no universe is known for it, the check cannot be performed and the record is rejected
(`... coverage cannot be checked: no entity list`) rather than trusted.

**The default is `bothTotal`**, for two reasons. It is what the IR layer already demands:
`validateCorrespondence` in `src/framework/ir/correspondence.ts` rejects an `EntityCorrespondence` that
does not account for every source and target entity. The contract layer accepted less than the layer
below it. And it changes nothing that exists today: all five requirement declarations in the repository
produce a mapping that is total on both sides.

Alternative considered: default `partial`, so that a contract keeps its old meaning. Rejected — it
rejects nothing of what probe 04 shows (zero groups pass), it makes the new field the only way to get
any check, and it forces every existing declaration to be touched to keep its old *strength*, whereas
`bothTotal` lets the ones that mean "the whole revision" say so by saying nothing.

### What each existing requirement now declares

| Requirement | Ports | Declares |
| --- | --- | --- |
| `tensor.lower-cuda` `kernels` (`src/tensor/cuda-contract.ts`) | `baseline` TixIR → `subject` CudaIR | `bothTotal`, written out: every Tix statement is computed by exactly one kernel and every kernel names the statements it computes. Measured on the whole tensor corpus, fused and unfused (`scripts/02-existing-correspondences-coverage.mjs`): no unmapped source or target. Cross-kind, so no diff audit. |
| `ir-lab.expression.transform` `entities` (`src/labs/contracts.ts`) | `input`/`output` ExpressionIR | `bothTotal` by default (the mapping is a `makeCorrespondence`, total by construction) |
| `ir-lab.scene.transform` `entities` | `input`/`output` SceneIR | `bothTotal` by default |
| `ir-lab.mesh.transform` `entities` | `input`/`output` MeshIR | `bothTotal` by default |
| `ir-lab.constraints.transform` `entities` | `input`/`output` ConstraintIR | `bothTotal` by default |

The four lab declarations keep the default rather than repeating it: `src/labs/` is outside this step's
scope, and the default states their meaning exactly. None of the four IR types enumerates its entities,
so their universes are the lists the correspondence declares (`makeCorrespondence`, total by construction).

## 2. Consistency with the structural diff

`src/framework/ir/diff.ts` classifies every entity of two revisions as `inserted` (only after),
`removed` (only before) or `updated`/unchanged (present in both). The manager has the two entity
universes, so it has the presence projection of that classification: `kept` (present in both, whether
unchanged or updated), `removed`, `inserted`. It does not have the two `IRGraph`s (the contracts layer is
given `IRType`s, not adapters), and it does not need them: the rule below is stated over presence only.

**The rule.** A group with an empty target list claims that its source entities have no counterpart in
the output. If the diff keeps any of them, the group contradicts the diff and the record is rejected:

```
entry { from: F, to: [] }  is rejected when some id in F is kept by the diff
```

The two other contradictions the diff could express are already impossible: a `removed` entity cannot be
an entry target and an `inserted` entity cannot be an entry source, because both are checked against the
target and source universes first.

Alternative considered: also reject `{ from: [], to: T }` when an id in `T` is kept ("claims a surviving
entity was created"). Rejected: the framework's own `makeCorrespondence` emits exactly that form, with
relation `unmapped-origin`, for a *kept* target that a caller's explicit entries did not map. Emptiness on
the source side therefore means "the mapping states no origin", not "this entity is new", and reading it
as a claim would reject the framework's own output. Making surviving entities be mapped is the job of the
coverage policy, not of the audit.

### Sharing the classification

`entityPresence(before, after)` is added to `src/framework/ir/diff.ts` and `diffGraphs` uses it, so that
"inserted / removed / kept" has one definition, and the audit's notion of what the diff says cannot drift
from the diff. Consequence: `contracts` now imports `ir/diff.ts` (it imported nothing outside `core`
before). `tests/framework/layering.test.mjs` still holds — it constrains imports *from core*, and there
is no cycle (`ir` imports `core` only). Alternative considered: a five-line presence loop inside the
manager, which would keep the contracts layer free of `ir` but duplicate the diff's entity classification
in the layer that audits it; the shared function is worth the one import.

## What is built in this session

- `src/framework/ir/diff.ts`: `EntityPresence`, `entityPresence`; `diffGraphs` uses it (same output).
- `src/framework/contracts/types.ts`: `CorrespondenceCoverage`, `CorrespondenceRequirement.coverage`.
- `src/framework/contracts/definitions.ts`: validates the vocabulary and fills in `bothTotal` at
  definition time, so a definition states what it declares.
- `src/framework/contracts/analysis-manager.ts`: coverage and the deletion rule in the requirement path;
  the transfer path is unchanged.
- `src/tensor/cuda-contract.ts`: the one requirement with a cross-kind mapping declares `bothTotal`.
- `tests/framework/r3-defects.test.mjs`: the `todo` on "F35" goes.
- `tests/framework/correspondence-coverage.test.mjs`: the vocabulary, the default, the audit under
  `partial`, and the cross-kind/same-kind boundary.
- `src/framework/contracts/README.md`: the two checks in the correspondence section.

## What this does not do

- It does not audit entry *relations*. `relation` is a free-form string (`'retained'`, `'removed'`,
  `'cse > retained'`), and the contract-level record does not attach one to each group.
- It does not diff contents, so a group may map an updated entity to itself without saying so.
- It does not change any pass, image, CUDA source or revision: the audited correspondences are the ones
  the framework itself builds, and they are already consistent (`scripts/02`).

### Later

- The `preserve`/transfer correspondence gets the same audit once a transfer rule can state its coverage.
- A relation vocabulary (`retained`/`fused`/`replaced`) on `CorrespondenceEntry` at the contract level,
  so the audit can check what a group says happened, not only where it points.
