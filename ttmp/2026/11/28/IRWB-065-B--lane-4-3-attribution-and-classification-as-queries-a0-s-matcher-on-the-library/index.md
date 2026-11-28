---
Title: 'Lane 4.3: attribution and classification as queries (A0''s matcher on the library)'
Ticket: IRWB-065-B
Status: active
Topics:
    - framework
    - derivation
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-28T03:39:54.944471479-05:00
WhatFor: ""
WhenToUse: ""
---

# Lane 4.3: attribution and classification as queries (A0's matcher on the library)

## Overview

Lane 4.3 of v7 phase 4: D1's instruction attribution, D2's provenance and A0's edit classification, as queries over
the records the passes write (the derivation, the correspondence chain). One framework query module
(`src/framework/ir/attribution.ts`), three adapters, A0's matcher on `src/stdlib/term`, the re-derivation code
deleted, and the 203/395 count settled at 395. Read `reference/02-report-attribution-provenance-and-classification-as-queries.md`.

## Key Links

- Design note: [design-doc/01-design-note-attribution-provenance-and-classification-as-queries.md](./design-doc/01-design-note-attribution-provenance-and-classification-as-queries.md)
- Report: [reference/02-report-attribution-provenance-and-classification-as-queries.md](./reference/02-report-attribution-provenance-and-classification-as-queries.md)
- Diary: [reference/01-diary.md](./reference/01-diary.md)
- Acceptance transcript: [various/acceptance.txt](./various/acceptance.txt)

## Status

Current status: **active**

## Topics

- framework
- derivation
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
