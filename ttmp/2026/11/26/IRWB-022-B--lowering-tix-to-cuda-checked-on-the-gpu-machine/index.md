---
Title: Lowering Tix to CUDA, checked, on the GPU machine
Ticket: IRWB-022-B
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
Summary: Stage 2 design and probes for checked Tix-to-CUDA lowering and the six corpus measurements.
LastUpdated: 2026-11-26T15:12:06.719264972-05:00
WhatFor: ""
WhenToUse: ""
---

# Lowering Tix to CUDA, checked, on the GPU machine

## Overview

Stage 2 lowers each Tix statement to a CUDA kernel and checks the selected function against the Stage 1 evaluators. The design is ready for review. Implementation and corpus measurements follow the review.

## Key Links

- [Checked CUDA lowering for Tix](design-doc/01-checked-cuda-lowering-for-tix.md)
- [Implementation diary](reference/01-implementation-diary.md)
- [GB10 probe observations](scripts/01-gb10-probe/observed.json)

## Status

Current status: **active**

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
