---
Title: Implementation report
Ticket: IRWB-062
Status: active
Topics:
    - compiler
    - framework
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Derived check modes
    - Path: repo://src/tensor/cuda-source.ts
      Note: Manifest and CUDA host emission
    - Path: repo://src/tensor/schedule.ts
      Note: Launch selects and guard coverage
    - Path: repo://tests/tensor/staged-choice.test.mjs
      Note: Observed differential batches
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-28T01:52:34.44994802-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation report


Tix schedules now carry an ordered launch select for both binary fusion gates and tiled contractions. Emission writes each predicate into the CUDA host code and includes the ordered arms in the kernel manifest. The TypeScript runtime reads gate names from those arms when decoding the host's decision bytes. The CUDA host applies the guards and the existing forced-mode overrides.

## Files

- `src/tensor/schedule.ts` defines the shared launch select, records it in the adapter view, and checks guard coverage during artifact validation and loop-plan eligibility.
- `src/tensor/strategy.ts` supplies the existing measured launch thresholds as variant arms.
- `src/tensor/cuda-source.ts` prints the row guard from the select and publishes both kinds of select in the manifest. The contraction printer already consumes the equivalent fields directly.
- `src/tensor/cuda-runtime.ts` derives the gate decoding order from manifest arms.
- `src/tensor/cuda-contract.ts` changes only `modesOf`. It derives forcing values from manifest arms and cycles the shorter set across the longer.
- `tests/tensor/plans.test.mjs` preserves the existing attention manifest summary checks and adds an exact ordered-arm assertion for the new manifest field.
- `tests/tensor/fusion.test.mjs` extends the exact softmax manifest expectation with its predicate and fallback.
- `tests/tensor/schedule.test.mjs` checks diagnostics for a shadowed variant arm, a launch with no fallback, and a gate with no reachable fallback.
- `tests/tensor/staged-choice.test.mjs` checks mode parity through the real differential with a mock executor, a fifth variant batch, and both gate sides with a single contraction variant.
- `tests/tensor/fixtures/schedule-features.tix` contains the schedule GPU feature functions used by the CPU parity test.
- `tests/tensor/schedule-gpu.test.mjs` reads the shared fixture and uses the emitted select for its mutant artifact, preserving its tiled-mode assertion.
- `tests/tensor/fusion-gpu.test.mjs` and `tests/tensor/terms-gpu.test.mjs` reuse the emitted gate manifest for their mutant artifacts. Their rejection assertions are unchanged.

## Coverage and scope

The guard check reasons over abstract launch statistics. It detects ordered shadowing by an earlier predicate for the same variant, an early unconditional arm, and an absent plain fallback. It does not solve correlations induced by tensor extents and variant-specific tile geometries. The gate check uses the bounds of its row and occupancy statistics.

A global forcing flag covers each compiled alternative with the existing ABI. Repeated predicates targeting the same variant share its semantic mode. A tiled forcing request still requires the grid to fit. Per-kernel forcing and a framework strategy node are deferred. Schedule validation is domain-local because the framework currently has compile-time dispatch and no guarded multiversion construct, and this lane owns no framework files. A future staged strategy could also represent alternatives emitted by a Typed runtime specializer. The old gate printer in `fusion.ts` was left in place because that file is outside this lane.

The site build is outside the conditional acceptance scope. No GPU test was executed. Syntax checks passed for the three changed GPU test files. The coordinator owns GPU execution at merge.

## Verification

Implementation commit `1097072`. The TypeScript build and check passed. The coordinator's baseline script printed `no differences`, including byte-identical CUDA. The three focused CPU test files passed all 16 tests. They cover every corpus function and the schedule fixtures with both fusion settings, through the normal differential and its injected batch executor.

| CPU suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Typed | 193 | 0 | 2 |
| Framework | 266 | 0 | 0 |
| Workbench | 24 | 0 | 1 |
| Stdlib | 61 | 0 | 0 |
| Tensor | 56 | 0 | 0 |

The existing opt-in Candela tests account for all three skips. The tensor suite was rerun after updating the exact softmax manifest expectation. The final test and documentation changes left compiled inputs to the baseline check unchanged.
