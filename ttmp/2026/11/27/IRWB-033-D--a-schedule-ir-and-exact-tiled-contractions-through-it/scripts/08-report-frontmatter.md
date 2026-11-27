---
Title: 'Report: a schedule IR and exact tiled contractions'
Ticket: IRWB-033-D
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/schedule.ts
      Note: Schedule IR, adapter, passes with legality, order analysis
    - Path: repo://src/tensor/strategy.ts
      Note: The scheduling rule, tile configurations and the launch rule
    - Path: repo://src/tensor/cuda-contraction.ts
      Note: Printer of contraction kernels
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Framework change, pass legality
    - Path: repo://tests/tensor/schedule-gpu.test.mjs
      Note: GB10 checks of tiled variants, large shapes and mutants
ExternalSources: []
Summary: "A v6 schedule IR between Tix and CUDA; contractions are tiled by checked passes into four launch-time variants; every corpus program bit-identical and no slower; one framework change (pass legality)."
LastUpdated: 2026-11-27T11:03:56.829746495-05:00
WhatFor: Final report of stage 6 (IRWB-033-D)
WhenToUse: Reviewing the schedule IR, its passes and checks, and the contraction timings
---

# Report: a schedule IR and exact tiled contractions

