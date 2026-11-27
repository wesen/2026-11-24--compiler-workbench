---
Title: Schedule IR and exact tiled contractions
Ticket: IRWB-033-A
Status: complete
Topics:
    - tensor
    - gpu
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Checked CUDA schedule pipeline with exact tiled contractions, fusion and GB10 measurements.
LastUpdated: 2026-11-27T10:54:25.154321187-05:00
WhatFor: ""
WhenToUse: ""
---

# Schedule IR and exact tiled contractions

## Overview

Stage 6 introduces the v6 schedule artifact and checks its rewrites before CUDA emission.

## Documents

- [Design](design-doc/01-schedule-ir-and-ordered-cuda-tiles.md)
- [Final report](reference/02-final-report.md)
- [Implementation diary](reference/01-implementation-diary.md)
- [Replay scripts and raw GPU evidence](scripts/)

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
