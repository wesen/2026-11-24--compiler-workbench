---
Title: 'F37: range analysis under nested loops'
Ticket: IRWB-043-C
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/dataflow/analysis.ts
      Note: the dataflow widen hook now sees the region it widens
    - Path: repo://src/typed/analyses.ts
      Note: 'typed.ranges: widening restricted to a loop''s assigned locals (F37)'
    - Path: repo://tests/typed/d2-defects.test.mjs
      Note: F37's test, todo removed
    - Path: repo://tests/typed/guards.test.mjs
      Note: counter test now asserts strength makes the rewrite
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T17:28:23.893215059-05:00
WhatFor: ""
WhenToUse: ""
---

# F37: range analysis under nested loops

## Overview

<!-- Provide a brief overview of the ticket, its goals, and current status -->

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- typed
- dataflow
- analysis
- widening

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
