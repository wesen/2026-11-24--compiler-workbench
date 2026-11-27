---
Title: Checked fusion of Tix statements into fewer CUDA kernels
Ticket: IRWB-029-H
Status: active
Topics:
    - compiler
    - ir
    - verification
    - gpu
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/fusion.ts
      Note: The plan and its legality rules
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T23:05:45.6790084-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked fusion of Tix statements into fewer CUDA kernels

Stage 3 of Tix. Stage 2 launched one kernel per statement; this stage fuses statements into fewer kernels from a
plan computed on the Tix IR, and checks the result under the same exact relation. Every corpus program now lowers to
one kernel, bit-identically, at 1.04x to 3.15x stage 2's GPU time where there was something to fuse. No framework or
tool source changed; the one place the framework does not fit is the correspondence of statements to kernels.

- [Design and amendments](design-doc/01-checked-fusion-of-tix-statements-into-fewer-cuda-kernels.md)
- [Report](reference/01-fusion-report-fewer-kernels-the-same-bits.md)
- [Implementation diary](reference/02-implementation-diary.md)
- [Tasks](tasks.md) · [Changelog](changelog.md)

## Overview

<!-- Provide a brief overview of the ticket, its goals, and current status -->

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- ir
- verification
- gpu

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
