---
Title: Checked lowering of Tix to CUDA on the GPU machine
Ticket: IRWB-022-G
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
Summary: Stage 2 review workspace for a checked, directly emitted CUDA translation of a Tix function.
LastUpdated: 2026-11-26T15:12:04.567309912-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked lowering of Tix to CUDA on the GPU machine

## Overview

Implemented a statement-per-kernel lowering and remote f64 tolerance check on the NVIDIA GB10. All six corpus functions passed. Full-size GPU event and interpreter wall times, sampling evidence and reproduction instructions are in the [results report](reference/02-cuda-lowering-results-and-timing-protocol.md).

## Key Links

- [Design and proposed framework/tool change ledgers](design-doc/01-lowering-tix-statements-to-cuda-with-a-batched-gpu-meaning-check.md)
- [Diary, probe commands and observed results](reference/01-implementation-diary.md)

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

- design-doc/ - Architecture and design documents
- reference/ - Prompt packs, API contracts, context summaries
- playbooks/ - Command sequences and test procedures
- scripts/ - Temporary code and tooling
- various/ - Working notes and research
- archive/ - Deprecated or reference-only artifacts
