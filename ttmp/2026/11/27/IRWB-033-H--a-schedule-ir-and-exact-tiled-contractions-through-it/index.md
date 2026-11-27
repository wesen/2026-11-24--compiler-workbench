---
Title: A schedule IR, and exact tiled contractions through it
Ticket: IRWB-033-H
Status: active
Topics:
    - tensor
    - gpu
    - verification
    - compiler
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/strategy/sync.ts
      Note: Synchronous plan executor (the interpreter is async)
    - Path: repo://src/tensor/cuda-source.ts
      Note: emitGemm and the printer that reads every decision from the schedule
    - Path: repo://src/tensor/schedule.ts
      Note: The schedule IR, its five passes and the accumulation-order analysis
    - Path: repo://src/tensor/strategy.ts
      Note: The rule as a Strategy IR plan, the variants and the cost model
    - Path: repo://tests/tensor/schedule.test.mjs
      Note: The IR, passes, order analysis and the rejected mutants
    - Path: repo://tests/tensor/tiled-gpu.test.mjs
      Note: GB10 exactness at 512^3 and the edges
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:07:06.865265651-05:00
WhatFor: ""
WhenToUse: ""
---

# A schedule IR, and exact tiled contractions through it

## Overview

<!-- Provide a brief overview of the ticket, its goals, and current status -->

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- tensor
- gpu
- verification
- compiler

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
