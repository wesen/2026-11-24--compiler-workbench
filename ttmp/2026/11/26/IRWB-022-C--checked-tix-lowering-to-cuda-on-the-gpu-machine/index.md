---
Title: Checked Tix lowering to CUDA on the GPU machine
Ticket: IRWB-022-C
Status: active
Topics:
    - compiler
    - ir
    - verification
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T15:12:24.942500141-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked Tix lowering to CUDA on the GPU machine

## Overview

Stage 2 lowers the stage-1 Tix IR to CUDA and checks the candidate remotely on GB10. The reviewed design is implemented; see the results for validation and workload measurements.

## Key links

- [Reviewed design](design-doc/01-checked-tix-to-cuda-lowering.md)
- [Validation and workload results](reference/02-cuda-lowering-results.md)
- [Implementation diary](reference/01-implementation-diary.md)
- [GB10 math probe](scripts/01-probe-gb10-math.mjs) and [local framework probe](scripts/02-probe-contract.mjs)

## Topics

- compiler
- ir
- verification
- performance

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
