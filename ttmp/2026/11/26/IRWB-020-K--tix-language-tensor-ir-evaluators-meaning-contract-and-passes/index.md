---
Title: Tix language, tensor IR, evaluators, meaning contract and passes
Ticket: IRWB-020-K
Status: complete
Topics:
    - compiler
    - ir
    - verification
    - typescript
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T12:55:57.15084957-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix language, tensor IR, evaluators, meaning contract and passes

## Overview

Stage 1 tests the IR Workbench framework on tensor programs: Tix source checking, a v6 IR, f32 and f64 evaluators, a sampled meaning contract, and the checked `inline` and `split-sum` passes. Stage 1 is implemented and validated. The design reflects the in-session review and records the only framework changes.

## Key Links

- [Tix stage 1 report](./reference/02-report.md), including the independent evaluation and rejection diagnosis
- [Tix stage 1 design](./design-doc/01-tix-stage-1-design.md), including the framework change ledger
- [Diary](./reference/01-diary.md), including the original request and replay evidence

## Status

Current status: **complete**

## Topics

- compiler
- ir
- verification
- typescript

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.

## Structure

- `design-doc/` — design and review decisions
- `reference/` — diary and validation evidence
