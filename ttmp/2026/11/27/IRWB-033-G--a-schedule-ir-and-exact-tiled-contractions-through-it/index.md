---
Title: A schedule IR and exact tiled contractions through it
Ticket: IRWB-033-G
Status: active
Topics:
    - tensor
    - gpu
    - compiler
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: A schedule IR between Tix and CUDA, four checked scheduling passes, an accumulation-order analysis, a strategy, and exact tiled contractions (matmul 512^3 0.070 ms, 4096^3 21.6 ms).
LastUpdated: 2026-11-27T10:05:09.605622141-05:00
WhatFor: ""
WhenToUse: ""
---

# A schedule IR and exact tiled contractions through it

## Overview

Stage 6 of Tix. A schedule IR (v6 artifact, `tensor.schedule`) sits between Tix and the CUDA source: the fusion plan
of stages 3 and 3b builds it, four scheduling passes refine it, an analysis of every reduction's visit order checks
each step without the GPU, a strategy picks the tiling, and the emitter prints it and decides nothing. Contractions
are tiled in shared memory with a register patch per thread and the reduction strip-mined in order, so every output
keeps the f32 meaning's sequence of rounded products and sums.

- **Design**: [design-doc/01](design-doc/01-schedule-ir-and-exact-tiled-contractions.md)
- **Report**: [reference/01](reference/01-report-schedule-ir-and-exact-tiled-contractions.md)
- **Diary**: [reference/02](reference/02-implementation-diary.md)
- **Scripts**: [scripts/](scripts/) — 01 hand-tiled GEMM probe, 02 tiled matmul on the GPU, 03 benchmarks, 04 contract
  cost, each with its `*.out.jsonl`.

## Key results

| Contraction | fused ms | unfused ms | TFLOP/s | /cuBLAS |
| --- | ---: | ---: | ---: | ---: |
| matmul 512³ | 0.070 | 0.210 | 3.84 | 2.13 |
| matmul 4096³ | 21.6 | 134.0 | 6.37 | 3.01 |
| attention's score | 0.0375 | 0.618 | 3.58 | 2.12 |
| mlp's h | 0.101 | 0.466 | 5.32 | 2.38 |
| mlp's y | 0.132 | 0.383 | 4.06 | 2.78 |

Nothing else got slower: softmax, layernorm, attention, mlp and conv2d emit stage 3b's bytes.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- tensor
- gpu
- compiler
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
