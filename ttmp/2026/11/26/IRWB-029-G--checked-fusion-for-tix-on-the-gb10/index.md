---
Title: Checked fusion for Tix on the GB10
Ticket: IRWB-029-G
Status: complete
Topics:
    - compiler
    - ir
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-source.ts
      Note: Fused and unfused emission from one plan
    - Path: repo://src/tensor/fusion.ts
      Note: Planner deciding groups and mappings from the Tix IR
    - Path: repo://tests/tensor/cuda-fused-gpu.test.mjs
      Note: Exact fused checks on the GB10
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T23:45:49.8357014-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked fusion for Tix on the GB10

## Overview

Stage 3 fuses Tix statements into fewer CUDA kernels without changing any result bit. Fusion is decided from the Tix
IR by a planner that the emitter consumes, so `fuse: false` still emits stage 2's text byte for byte and `fuse: true`
emits one kernel per group, with a block per row and staged rows where a reduction needs them.

On the six corpus programs at the brief's sizes the fused lowering is **word-identical** to stage 2 and to the f32
meaning, and `checkLowering` accepts it as exact on both the original and the optimized revision. Kernel counts go
`1→1, 4→1, 4→1, 6→1, 3→1, 1→1` and the benchmark times (median of three, GB10) `0.207/0.214, 0.476/0.802,
0.210/0.519, 0.800/1.191, 0.985/1.068, 0.192/0.175` ms. The framework needed no change; its correspondence layer
can express many statements becoming one kernel, but this lowering's CUDA port exposes no entities to name (probe
`scripts/01`).

- [Design: checked fusion of Tix statements into fewer kernels](design-doc/01-checked-fusion-of-tix-statements-into-fewer-kernels.md)
- [Implementation diary](reference/01-implementation-diary.md)
- [Final report](reference/02-report.md)
- [Tasks](tasks.md), [changelog](changelog.md), [scripts](scripts/)

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- ir
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
