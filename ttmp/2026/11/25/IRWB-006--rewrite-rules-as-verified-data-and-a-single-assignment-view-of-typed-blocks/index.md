---
Title: Rewrite rules as verified data and a single-assignment view of typed.blocks
Ticket: IRWB-006
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/ir/rewrites.ts
      Note: the framework rule engine, evaluated
    - Path: repo://src/typed/analyses.ts
      Note: dominators and reaching definitions the SSA view is checked against
    - Path: repo://src/typed/passes.ts
      Note: simplify and fold, the passes turned into rule tables
    - Path: repo://src/typed/tx.ts
      Note: Tx.rewrite, the only way a rule changes a program
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-25T23:07:55.075945358-05:00
WhatFor: ""
WhenToUse: ""
---

# Rewrite rules as verified data and a single-assignment view of typed.blocks

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
