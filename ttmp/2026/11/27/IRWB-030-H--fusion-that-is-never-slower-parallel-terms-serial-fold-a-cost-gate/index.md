---
Title: 'Fusion that is never slower: parallel terms, serial fold, a cost gate'
Ticket: IRWB-030-H
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-contract.ts
      Note: |-
        CudaKernel.terms; tensor.cuda-source and tensor.lower-cuda at version 3
        kernel terms in the artifact, versions 3
    - Path: repo://src/tensor/cuda-source.ts
      Note: |-
        staged-term prologue and order-preserving fold in block mode
        staged-term prologue and fold, term region layout
    - Path: repo://src/tensor/fusion.ts
      Note: |-
        stageTerms, terms/serial in the plan, fusionGate and groupRow
        stageTerms, terms/serial, fusionGate, groupRow
    - Path: repo://src/tensor/index.ts
      Note: |-
        shapes option, launchShapes, loweredTix; runTixCuda applies the gate
        shapes option, launchShapes, loweredTix
    - Path: repo://tests/tensor/fusion-terms-gpu.test.mjs
      Note: GB10 exactness of staged terms, mutants, and a gated launch
    - Path: repo://tests/tensor/fusion-terms.test.mjs
      Note: plan, source and gate tests without the GPU
    - Path: repo://ttmp/2026/11/27/IRWB-030-H--fusion-that-is-never-slower-parallel-terms-serial-fold-a-cost-gate/reference/02-report-fusion-that-is-never-slower.md
      Note: Final report
ExternalSources: []
Summary: Stage 3b of Tix — a block-mode row reduction computes its terms with the whole block and folds them in the meaning's order with one thread, and a measured warp-boundary gate keeps a program on stage 2's lowering when block mode would leave lanes idle.
LastUpdated: 2026-11-27T04:40:00-05:00
WhatFor: ""
WhenToUse: ""
---

# Fusion that is never slower — parallel terms, serial fold, a cost gate

## Overview

Stage 3 of Tix fused every legal producer-consumer chain but was not faster when a row reduction divides inside the
sum: block mode ran the whole reduction on thread 0 of each row's block. Stage 3b

- **stages the terms** of a row-scalar member's reduction: the whole block computes them into the row buffer, one
  thread folds them in the meaning's order, so the result is the same f32 word;
- **gates fusion** on a measured rule: when a block-mode group's longest row is shorter than one warp, block mode
  leaves lanes idle and the program keeps stage 2's lowering.

Headline: `layernorm-inside` 0.216 ms fused against 0.561 unfused (2.59×, was 0.573 against 0.569); the six corpus
programs still one kernel each, all bit-identical to the f32 meaning; `attention-inside` 1.413 against 1.486. No
framework or tool change.

- [Design](design-doc/01-fusion-that-is-never-slower-parallel-terms-serial-fold-a-cost-gate.md)
- [Implementation diary](reference/01-implementation-diary.md)
- [Report](reference/02-report-fusion-that-is-never-slower.md)
- Scripts and their outputs: `scripts/` (numbered in the order written)

## Status

Current status: **active** (implementation, tests and report done; review pending)

## Tasks

See [tasks.md](./tasks.md) — all done.

## Changelog

See [changelog.md](./changelog.md).

## Structure

- design-doc/ — the design, and its "As built" section
- reference/ — implementation diary and final report
- scripts/ — probes, benchmarks, random programs, with their outputs
- various/, sources/, playbooks/, archive/ — unused in this stage
