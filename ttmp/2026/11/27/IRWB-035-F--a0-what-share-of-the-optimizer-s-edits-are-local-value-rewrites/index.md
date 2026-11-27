---
Title: 'A0: what share of the optimizer''s edits are local value rewrites'
Ticket: IRWB-035-F
Status: active
Topics:
    - compiler
    - rewrite-rules
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:03:36.59956844-05:00
WhatFor: ""
WhenToUse: ""
---

# A0: what share of the optimizer's edits are local value rewrites

## Overview

Measures what share of the edits that O2 and `speed` make on the corpus are local value rewrites (verified or fact-guarded), structural or other, by edit count and by instructions, and how much of the local share is covered by verified rules. Status: done.

- Design: [design-doc/01-…](./design-doc/01-design-classifying-the-optimizer-s-edits-as-local-structural-or-other.md)
- Report: [report/01-…](./report/01-report-the-share-of-local-rewrites-in-o2-and-speed.md)
- Diary: [diary/01-diary.md](./diary/01-diary.md)
- Tool: `tools/edit-classes.mjs`; classifier: `src/typed/edit-classes.ts`

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- rewrite-rules

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
