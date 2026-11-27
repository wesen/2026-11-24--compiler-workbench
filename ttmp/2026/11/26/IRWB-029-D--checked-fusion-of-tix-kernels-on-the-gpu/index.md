---
Title: Checked fusion of Tix kernels on the GPU
Ticket: IRWB-029-D
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
      Note: fuse port and statements-to-kernels correspondence
    - Path: repo://src/tensor/cuda-source.ts
      Note: Group emitter and shared scalar writer
    - Path: repo://src/tensor/fusion.ts
      Note: Legality analysis on the Tix IR
    - Path: repo://tests/tensor/fusion-gpu.test.mjs
      Note: GB10 checks of fused lowerings
    - Path: repo://ttmp/2026/11/26/IRWB-029-D--checked-fusion-of-tix-kernels-on-the-gpu/reference/02-report-checked-fusion-of-tix-kernels.md
      Note: Final report
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T23:03:13.073524542-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked fusion of Tix kernels on the GPU

## Overview

Stage 3 of Tix: fuse statements into fewer CUDA kernels without changing any result bit, decided from the Tix IR and checked on the GB10 under the exact relation.

- [Design](design-doc/01-checked-fusion-of-tix-statements-into-cuda-kernels.md)
- [Implementation diary](reference/01-implementation-diary.md)
- [Report](reference/02-report-checked-fusion-of-tix-kernels.md)
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
