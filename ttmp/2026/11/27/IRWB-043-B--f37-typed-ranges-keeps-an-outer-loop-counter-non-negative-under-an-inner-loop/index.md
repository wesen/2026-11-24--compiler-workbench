---
Title: 'F37: typed.ranges keeps an outer loop counter non-negative under an inner loop'
Ticket: IRWB-043-B
Status: active
Topics:
    - compiler
    - ranges
    - analysis
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/dataflow/lattices.ts
      Note: the interval lattice gained widening up-to (thresholds parameter)
    - Path: repo://src/typed/analyses.ts
      Note: typed.ranges widens up-to powers of two; version 2
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T17:32:22.442572543-05:00
WhatFor: ""
WhenToUse: ""
---

# F37: typed.ranges keeps an outer loop counter non-negative under an inner loop

## Overview

<!-- Provide a brief overview of the ticket, its goals, and current status -->

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- ranges
- analysis

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
