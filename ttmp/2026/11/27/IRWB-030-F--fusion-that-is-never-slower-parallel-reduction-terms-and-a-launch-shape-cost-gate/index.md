---
Title: 'Fusion that is never slower: parallel reduction terms and a launch-shape cost gate'
Ticket: IRWB-030-F
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/fusion.ts
      Note: Staged reductions in the plan and the launch-shape cost gate (gatedPlan)
    - Path: repo://src/tensor/cuda-source.ts
      Note: Fill-and-fold emitter for staged reductions, template on Shared and Staged
    - Path: repo://src/tensor/index.ts
      Note: runTixCuda lowers through the gated plan from the input shapes
    - Path: repo://ttmp/2026/11/27/IRWB-030-F--fusion-that-is-never-slower-parallel-reduction-terms-and-a-launch-shape-cost-gate/reference/02-report-fusion-that-is-never-slower.md
      Note: Final report
ExternalSources: []
Summary: "Stage 3b: compute a row reduction's terms in parallel and fold them in order on one thread (bit-identical by construction), and gate block-mode fusion on the launch shapes so fusion is never slower than stage 2."
LastUpdated: 2026-11-27T02:00:00-05:00
WhatFor: ""
WhenToUse: ""
---

# Fusion that is never slower: parallel reduction terms and a launch-shape cost gate

## Overview

Stage 3 fused every legal producer-consumer chain, but a block-mode row reduction runs its whole body serially on thread 0 of the row's block, so a costly body (a division per term) loses stage 2's row concurrency; on the "inside" placements the fused margin over unfused is inside run-to-run noise. This stage stages a row reduction's terms in parallel (any thread computes a term, one thread folds them in the meaning's order, so the result stays bit-identical) and adds a launch-shape cost gate that keeps a block-mode group unfused when its fused parallelism would leave the GPU unsaturated.

- [Design](design/01-fusion-that-is-never-slower.md)
- [Implementation diary](reference/01-implementation-diary.md)
- Report: reference/02-report-fusion-that-is-never-slower.md (added at the end)
- Scripts and their outputs: `scripts/` (numbered in the order written)

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- tensor
- gpu
- verification

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.

## Structure

- design/ - Architecture and design documents
- reference/ - Prompt packs, API contracts, context summaries
- playbooks/ - Command sequences and test procedures
- scripts/ - Temporary code and tooling
- various/ - Working notes and research
- archive/ - Deprecated or reference-only artifacts
