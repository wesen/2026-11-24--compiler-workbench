---
Title: Checked fusion for Tix on the GB10
Ticket: IRWB-029-G
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T23:11:48.554187403-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked fusion for Tix on the GB10

## Overview

Stage 3 fuses Tix statements into fewer CUDA kernels without changing any result bit. Fusion is decided from the Tix
IR by a planner that the emitter consumes; the frame of reference, the legality rules and the refused fusions are in
the design, and the measured kernel counts, times and global traffic go in the final report.

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
