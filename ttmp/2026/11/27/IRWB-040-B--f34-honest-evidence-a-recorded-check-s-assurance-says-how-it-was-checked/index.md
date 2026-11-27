---
Title: 'F34: honest evidence - a recorded check''s assurance says how it was checked'
Ticket: IRWB-040-B
Status: active
Topics:
    - framework
    - contracts
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/analysis-manager.ts
      Note: invariantInternal stamps assuranceOf(result.evidence); assuranceOf moved here and made honest
    - Path: repo://src/framework/contracts/differential.ts
      Note: old assuranceOf replaced by an honest re-export from analysis-manager
    - Path: repo://src/framework/contracts/types.ts
      Note: Assurance gains checked-sampled and checked-exact
    - Path: repo://tests/framework/r3-defects.test.mjs
      Note: the F34 test, its todo removed in the fix commit
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T17:29:26.017047326-05:00
WhatFor: ""
WhenToUse: ""
---

# F34: honest evidence - a recorded check's assurance says how it was checked

## Overview

<!-- Provide a brief overview of the ticket, its goals, and current status -->

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- framework
- contracts

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
