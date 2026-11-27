---
Title: 'Missed optimizations found from provenance: hot instructions with no rule, new verified rules'
Ticket: IRWB-037-G
Status: active
Topics:
    - compiler
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: src/typed/missed.ts
      Note: hotShapes, the tool
    - Path: src/typed/guards.ts
      Note: threadTests, copyReads, guardPlan
    - Path: src/typed/passes.ts
      Note: the five passes and speed's list
    - Path: src/typed/rules/identities.ts
      Note: the three rules
    - Path: src/framework/dataflow/scoped.ts
      Note: the framework change
    - Path: tools/missed.mjs
      Note: command line
ExternalSources: []
Summary: Hot shapes by provenance (missed.ts); five passes and three verified rules added to speed; corpus -9.0% under speed
LastUpdated: 2026-11-27T12:39:57.989610377-05:00
WhatFor: ""
WhenToUse: ""
---

# Missed optimizations found from provenance: hot instructions with no rule, new verified rules

## Overview

D2 of the model comparison: find hot executed instructions that no rule or pass has improved, name the
shapes, and add the rules and pass changes that pay.

- Design: [design-doc/01](./design-doc/01-hot-shapes-from-provenance-and-three-pass-changes-branch-threading-guard-facts-copies.md)
- Report: [reference/02](./reference/02-report-missed-optimizations-found-from-provenance.md)
- Diary: [reference/01](./reference/01-implementation-diary.md)
- Scripts, numbered in the order written: [scripts/](./scripts/); their outputs: [various/](./various/)

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
