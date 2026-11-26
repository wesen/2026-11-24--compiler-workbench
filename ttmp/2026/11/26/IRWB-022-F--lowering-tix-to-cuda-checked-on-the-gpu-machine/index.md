---
Title: Lowering Tix to CUDA, checked, on the GPU machine
Ticket: IRWB-022-F
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
LastUpdated: 2026-11-26T15:11:35.928032323-05:00
WhatFor: ""
WhenToUse: ""
---

# Lowering Tix to CUDA, checked, on the GPU machine

## Overview

Stage 2: lower Tix statements to CUDA, check candidate results on the GB10, and measure the six corpus programs against the local f32 interpreter. The design and numerical probe are ready for review; implementation is pending.

## Key Links

- [Design: Checked Tix to CUDA lowering](design-doc/01-checked-tix-to-cuda-lowering.md)
- [Implementation diary](reference/01-implementation-diary.md)
- [Standalone GB10 numerical probe](scripts/01-probe-numerics.mjs)

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
