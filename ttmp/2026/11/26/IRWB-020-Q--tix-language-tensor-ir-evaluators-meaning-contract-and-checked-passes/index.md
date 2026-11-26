---
Title: Tix language, tensor IR, evaluators, meaning contract and checked passes
Ticket: IRWB-020-Q
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
LastUpdated: 2026-11-26T13:44:24.83829193-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix language, tensor IR, evaluators, meaning contract and checked passes

## Overview

Bring up Tix as a second domain on the v6 IR framework: language and validator, tensor IR, f32/f64 evaluation, checked `inline` and `split-sum`, and a six-program corpus. The design is ready for review; implementation has not started.

## Key Links

- [Stage 1 design and proposed framework changes](design-doc/01-stage-1-design.md)
- [Diary](reference/01-diary.md)

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
