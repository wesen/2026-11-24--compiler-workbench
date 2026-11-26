---
Title: Checked lowering of Tix to CUDA on the GPU machine
Ticket: IRWB-022-D
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
LastUpdated: 2026-11-26T15:12:00.699140226-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked lowering of Tix to CUDA on the GPU machine

## Overview

Stage 2 checks a direct CUDA lowering of Tix against the stage-1 meaning on the remote GB10. The reviewed lowering is implemented and checked on the live device. All six full-size measurements and the tensor regression results are in the [measurement report](reference/02-gb10-corpus-measurements-and-validation.md).

## Key Links

- [Final report: what a checked CUDA lowering preserves](reference/02-report.md)

- [Design: lowering, numerical relation and framework/tool ledger](design-doc/01-a-checked-tix-to-cuda-lowering-on-gb10.md)
- [Diary: design checkpoint and probe reproduction](reference/01-design-and-implementation-diary.md)
- [Predecessor: stage-1 report](../IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/02-report.md)

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
