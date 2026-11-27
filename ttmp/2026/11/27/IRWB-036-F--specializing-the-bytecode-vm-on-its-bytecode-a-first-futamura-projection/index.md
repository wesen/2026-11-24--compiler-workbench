---
Title: 'Specializing the bytecode VM on its bytecode: a first Futamura projection'
Ticket: IRWB-036-F
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/pe.ts
      Note: binding-time analysis and the pe pass
    - Path: repo://src/typed/promote.ts
      Note: frame-array promotion
    - Path: repo://src/typed/specialize.ts
      Note: buffer bindings and the promise check
    - Path: repo://src/typed/webs.ts
      Note: live-range splitting
    - Path: repo://tests/typed/pe.test.mjs
      Note: tests
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:01:50.310484584-05:00
WhatFor: ""
WhenToUse: ""
---

# Specializing the bytecode VM on its bytecode: a first Futamura projection

## Overview

Specializes the bytecode VM (IRWB-012) on its code image and entry: a checked buffer binding, a binding-time
analysis, polyvariant specialization of the dispatch loop (`pe`), frame-array promotion (`promote`) and
live-range splitting (`webs`). Result at n = 12, seed = 8: 74 and 74 RV32 instructions (hand-written 75 and 74,
general 7,678 and 6,874), 36-byte functions. Design in design-doc/01, results in reference/01, diary in log/01.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- ir
- performance

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
