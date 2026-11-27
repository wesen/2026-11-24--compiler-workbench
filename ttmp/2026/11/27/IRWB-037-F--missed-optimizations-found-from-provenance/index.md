---
Title: Missed optimizations found from provenance
Ticket: IRWB-037-F
Status: active
Topics:
    - compiler
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/attribute.ts
      Note: hotSites
    - Path: repo://src/typed/passes.ts
      Note: the pass changes
    - Path: repo://src/typed/rules/bitwise.ts
      Note: bitwise rules
    - Path: repo://src/typed/rules/reassoc.ts
      Note: reassoc rules
    - Path: repo://tests/typed/missed.test.mjs
      Note: tests
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T12:41:33.947506109-05:00
WhatFor: ""
WhenToUse: ""
---

# Missed optimizations found from provenance

## Overview

D2: missed optimizations found from provenance. Hot statements with provenance (`hotSites`), a shape census
and the gap to the reference found five shapes; bce, licm-lengths, two verified rule tables (reassoc, bitwise), a
verifier extension and an lvn fix took speed from 867,770 to 847,183 instructions over the corpus (tuned 792,800 to
772,952). Design: `design-doc/01-...`; report: `reference/02-report-...`; diary: `reference/01-...`.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
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
