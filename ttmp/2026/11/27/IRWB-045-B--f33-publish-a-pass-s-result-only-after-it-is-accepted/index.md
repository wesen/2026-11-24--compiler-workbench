---
Title: 'F33: publish a pass''s result only after it is accepted'
Ticket: IRWB-045-B
Status: active
Topics:
    - framework
    - passes
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/passes/define-pass.ts
      Note: 'The acceptance boundary: prepareNative''s private candidate store, the deferred contract commit, and the commit/retain/rollback ordering'
    - Path: repo://tests/framework/r3-defects.test.mjs
      Note: The two F33 tests, their todo removed in the fix commit
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T18:40:09.138874453-05:00
WhatFor: ""
WhenToUse: ""
---

# F33: publish a pass's result only after it is accepted

## Overview

<!-- Provide a brief overview of the ticket, its goals, and current status -->

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- framework
- passes

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
