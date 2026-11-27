---
Title: 'Fusion that is never slower: parallel terms and a cost gate'
Ticket: IRWB-030-G
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
      Note: planTerms (parallel terms), blockWidth/applyGate (the cost gate)
    - Path: repo://src/tensor/cuda-source.ts
      Note: Term arrays in the block-mode emitter; the fold reads a staged term instead of computing it
    - Path: repo://src/tensor/index.ts
      Note: The lowering is planned with the launch's shape values when they are known
    - Path: repo://tests/tensor/terms.test.mjs
      Note: Plans, staging decisions, refusals and the gate, without a GPU
    - Path: repo://tests/tensor/terms-gpu.test.mjs
      Note: GB10 exactness of staged terms, the gated source, and four mutants
    - Path: repo://ttmp/2026/11/27/IRWB-030-G--fusion-that-is-never-slower-parallel-terms-and-a-cost-gate/reference/02-report-fusion-that-is-never-slower.md
      Note: Final report
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T01:26:15.056939378-05:00
WhatFor: ""
WhenToUse: ""
---

# Fusion that is never slower: parallel terms and a cost gate

## Overview

Stage 3b of Tix. Stage 3's fusion is exact but does not always pay: a row-scalar reduction runs every term on
thread 0, and a block-mode group whose rows are shorter than a warp leaves most of its lanes idle. This stage

- computes a reduction's **terms in parallel** — the block writes them into a term array, one thread folds them in
  the meaning's order, so the result stays bit-identical — and
- adds a **cost gate**: a block-mode group stays fused only when it puts at least one warp of lanes to work, decided
  from the Tix IR and the launch's shape values.

- [Design](design-doc/01-fusion-that-is-never-slower-parallel-terms-and-a-cost-gate.md)
- [Implementation diary](reference/01-implementation-diary.md)
- [Report](reference/02-report-fusion-that-is-never-slower.md)
- Scripts and their outputs: `scripts/` (numbered in the order written)

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active** — implemented, checked on the GB10, measured; see the report.

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
