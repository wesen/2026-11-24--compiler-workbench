---
Title: One runner with two drivers
Ticket: IRWB-051-B
Status: review
Topics:
    - framework
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/analysis-manager.ts
      Note: Shared lookup and record construction
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Transformation lifecycle and drivers
    - Path: repo://tests/framework/transformation-drivers.test.mjs
      Note: Corpus and rejection evidence
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T20:20:02.292924323-05:00
WhatFor: ""
WhenToUse: ""
---

# One runner with two drivers

## Overview

Judge whether synchronous native transformations can use ordinary manager records. See the [decision and measurements](various/01-report.md), [committed design](design/01-runner.md) and [short diary](reference/01-diary.md).

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **review**

## Topics

- framework

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
