---
Title: 'The standard library''s lattices: moved from the framework''s dataflow layer, with SCCP as the second client'
Ticket: IRWB-048-B
Status: active
Topics:
    - compiler
    - ir
    - typescript
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/stdlib/lattice/lattices.ts
      Note: the moved module (interface, set, flat, interval with thresholds, map)
    - Path: repo://src/framework/dataflow/lattices.ts
      Note: re-export shim, so the dataflow layer's callers are unchanged
    - Path: repo://src/typed/sccp.ts
      Note: second client, on the library's flat lattice
    - Path: repo://tests/stdlib/lattice.test.mjs
      Note: the join laws on every triple, the widening bounds and termination, the thresholds
ExternalSources: []
Summary: "The framework's lattice module moved to src/stdlib/lattice unchanged, re-exported by the dataflow layer; SCCP is the second client on the library's flat lattice"
LastUpdated: 2026-11-27T20:21:51.958063168-05:00
WhatFor: ""
WhenToUse: ""
---

# The standard library's lattices: moved from the framework's dataflow layer, with SCCP as the second client

## Overview

IRWB-039 phase 2c, second extraction: the framework's lattices (`src/framework/dataflow/lattices.ts`)
moved into the standard library as `src/stdlib/lattice/lattices.ts` — the `Lattice` interface and the
set, flat, interval (with the up-to widening and thresholds) and map lattices — and the framework's
dataflow layer re-exports them, so its callers keep their imports. The second client is SCCP
(`src/typed/sccp.ts`), which now runs on the library's flat lattice; its private three-level lattice
was compared with the library's element by element before it was replaced.

Done. Acceptance: `tests/stdlib/lattice.test.mjs` (17 tests) pass, the coordinator's baselines print
`no differences`, `tests/{stdlib,framework,workbench,typed,tensor}` pass (522 pass, 0 fail, 3
pre-existing skips), `npm run check` clean, the site builds. Read
[the report](./reference/02-report-the-lattices-in-the-standard-library.md) and
[the diary](./reference/01-implementation-diary.md).

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **done** (2026-11-27); follow-ups listed in tasks.md

## Topics

- compiler
- ir
- typescript

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
