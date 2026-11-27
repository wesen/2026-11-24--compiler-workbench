---
Title: 'Fusion that is never slower: parallel reduction terms and a cost gate'
Ticket: IRWB-030-D
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/27/IRWB-030-D--fusion-that-is-never-slower-parallel-reduction-terms-and-a-cost-gate/design-doc/01-parallel-reduction-terms-and-a-fusion-cost-gate.md
      Note: Design
    - Path: repo://ttmp/2026/11/27/IRWB-030-D--fusion-that-is-never-slower-parallel-reduction-terms-and-a-cost-gate/reference/02-report-fusion-that-is-never-slower.md
      Note: Final report
ExternalSources: []
Summary: Stage 3b of the Tix CUDA lowering; staged reduction terms and a measured row-length gate, so fused is never slower than unfused on the corpus and the inside variants.
LastUpdated: 2026-11-27T01:23:02.716480588-05:00
WhatFor: ""
WhenToUse: ""
---

# Fusion that is never slower: parallel reduction terms and a cost gate

## Overview

Stage 3b (IRWB-030-D) of Tix's CUDA lowering. A block-mode kernel's row scalars now compute costly reduction terms with all threads and fold them in order on thread 0. `runTixCuda` runs stage 2's lowering when a block-mode kernel's rows are shorter than 24 elements. Every corpus program and both "inside" variants are one kernel, exact, and not slower fused than unfused.

- Design: [design-doc/01-parallel-reduction-terms-and-a-fusion-cost-gate.md](./design-doc/01-parallel-reduction-terms-and-a-fusion-cost-gate.md)
- Report: [reference/02-report-fusion-that-is-never-slower.md](./reference/02-report-fusion-that-is-never-slower.md)
- Diary: [reference/01-implementation-diary.md](./reference/01-implementation-diary.md)
- Scripts: `scripts/01` to `14`, numbered in the order written; `.out.jsonl` files are their raw outputs.

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
