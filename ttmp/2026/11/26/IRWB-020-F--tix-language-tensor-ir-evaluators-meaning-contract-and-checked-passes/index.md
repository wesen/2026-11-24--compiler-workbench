---
Title: Tix language, tensor IR, evaluators, meaning contract and checked passes
Ticket: IRWB-020-F
Status: complete
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
LastUpdated: 2026-11-26T14:05:58.842063565-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix language, tensor IR, evaluators, meaning contract and checked passes

## Overview

Introduce Tix as the second domain on the v6 framework: source and shape checking, tensor IR, f32/f64
interpreters, sampled meaning contracts, and checked `inline` and `split-sum` passes. The framework changes
and their rationale are the primary result. Stage 1 is implemented and validated; see the diary for test results.

## Key Links

- [Stage 1 design and framework change ledger](./design-doc/01-stage-1-design-tix-and-checked-tensor-passes.md)
- [Diary](./reference/01-diary.md)
- [Final report and independent evaluation](./reference/02-report.md)

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
