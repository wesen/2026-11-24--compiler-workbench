---
Title: 'stdlib/lattice: the lattices of dataflow analysis'
Ticket: IRWB-048-A
Status: complete
Topics:
    - compiler
    - ir
    - typescript
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/dataflow/lattices.ts
      Note: the re-export seam; callers keep their imports
    - Path: repo://src/stdlib/index.ts
      Note: the library index; lattice/ admitted
    - Path: repo://src/stdlib/lattice/lattices.ts
      Note: the moved lattices — Lattice interface, set, flat, interval (widen up-to thresholds), map
    - Path: repo://tests/framework/layering.test.mjs
      Note: admits the library below the framework
    - Path: repo://tests/stdlib/lattice.test.mjs
      Note: the lattice laws over generated pools
ExternalSources: []
Summary: "The framework's dataflow lattices moved to src/stdlib/lattice; the framework re-exports them at a seam; the lattice laws tested over generated pools; SCCP's lattice checked and left (the flat lattice's dual)."
LastUpdated: 2026-11-27T20:20:35.463008596-05:00
WhatFor: ""
WhenToUse: ""
---

# stdlib/lattice: the lattices of dataflow analysis

## Overview

The framework's dataflow lattices — the `Lattice` interface and the set, flat, interval (with
widening up-to thresholds) and map constructions of `src/framework/dataflow/lattices.ts` — move to
`src/stdlib/lattice/lattices.ts`, the second primitive of the standard library (IRWB-039 phase 2c).
The framework's dataflow layer re-exports them at a seam, so its callers (solver, analysis, the
typed analyses, the workbench) keep their imports unchanged. The lattice laws — commutativity,
associativity, idempotence, bottom as join's identity, widening an upper bound that stabilizes an
increasing chain — are checked on each lattice over generated pools in `tests/stdlib/lattice.test.mjs`.
SCCP's private three-level lattice was checked against the library's flat lattice (probe 01) and
left: it is the flat lattice's dual — a meet semilattice descending from TOP over typed constants —
not the same lattice. Complete: baselines print no differences; the report is
`reference/02-report-stdlib-lattice-the-lattices-of-dataflow-analysis.md`.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

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
