---
Title: 'Tix: an index-notation tensor language on the framework - its IR, f32 and f64 evaluators, a meaning contract, and the inline and split-sum passes'
Ticket: IRWB-020-M
Status: active
Topics:
    - tensor
    - compiler
    - ir
    - verification
    - typescript
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: F3 changes this file
    - Path: repo://src/framework/passes/define-pass.ts
      Note: F1 and F2 change this file
    - Path: repo://ttmp/2026/11/26/IRWB-020-M--tix-an-index-notation-tensor-language-on-the-framework-its-ir-f32-and-f64-evaluators-a-meaning-contract-and-the-inline-and-split-sum-passes/design-doc/01-stage-1-design-tix-its-ir-evaluators-meaning-contract-and-two-passes.md
      Note: stage-1 design
    - Path: repo://ttmp/2026/11/26/IRWB-020-M--tix-an-index-notation-tensor-language-on-the-framework-its-ir-f32-and-f64-evaluators-a-meaning-contract-and-the-inline-and-split-sum-passes/reference/01-diary.md
      Note: diary
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T13:11:10.344674391-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix: an index-notation tensor language on the framework - its IR, f32 and f64 evaluators, a meaning contract, and the inline and split-sum passes

## Overview

Stage 1 of the tensor track: Tix (an index-notation language) on the framework, with its IR artifact, f32 and f64
evaluators, a meaning contract (exact and tolerance relations), the checked passes `inline` and `split-sum`, and a
corpus under `corpus/tensor/`. The framework changes it needs are the primary result.

Current status: design written, waiting for review. Read
[the design](./design-doc/01-stage-1-design-tix-its-ir-evaluators-meaning-contract-and-two-passes.md) (§1 lists the
three proposed framework changes) and [the diary](./reference/01-diary.md).

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- tensor
- compiler
- ir
- verification
- typescript

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
