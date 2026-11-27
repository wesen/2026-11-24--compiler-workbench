---
Title: 'Best-in-class Tix: exact-meaning performance research'
Ticket: IRWB-023-C
Status: active
Topics:
    - compiler
    - research
    - performance
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Lowering relation that stage A changes
    - Path: repo://ttmp/2026/11/26/IRWB-023-C--best-in-class-tix-exact-meaning-performance-research/design-doc/01-exact-meaning-performance-for-tix.md
      Note: Design document
    - Path: repo://ttmp/2026/11/26/IRWB-023-C--best-in-class-tix-exact-meaning-performance-research/scripts/03-fused-exact.mjs
      Note: Corpus-wide exact kernels
ExternalSources: []
Summary: Best in class defined as exact-meaning performance; four ranked proposals with GB10 evidence.
LastUpdated: 2026-11-26T18:30:23.459194992-05:00
WhatFor: ""
WhenToUse: ""
---

# Best-in-class Tix: exact-meaning performance research

Research round (no product-code changes). The thesis: Tix should be the fastest compiler whose output is bit-identical to its portable f32 meaning, with evidence for every step. GB10 experiments back four ranked proposals. Hand-written exact kernels for the six corpus programs are bit-identical to Stage 2 and 3.76× faster in geometric mean. Fast `exp` and `tanh` paths are proven equal to the meaning on all 2^32 inputs. Symbolic fingerprints decide exactness per shape for all data. A prototype planner generates exact schedules from the Tix IR for five of the six programs (3.19× geometric mean).

- [Design document](design-doc/01-exact-meaning-performance-for-tix.md)
- [Research diary](reference/01-research-diary.md)
- Experiments: `scripts/` (results in `scripts/results/`)
- [Tasks](tasks.md)
- [Changelog](changelog.md)
