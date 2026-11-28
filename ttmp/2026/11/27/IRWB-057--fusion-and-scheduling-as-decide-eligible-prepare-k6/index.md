---
Title: Fusion and scheduling as decide, eligible, prepare (K6)
Ticket: IRWB-057
Status: active
Topics:
    - tensor
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T23:50:50.259756165-05:00
WhatFor: ""
WhenToUse: ""
---

# Fusion and scheduling as decide, eligible, prepare (K6)

## Overview

Phase 4 of IRWB-039, concept K6: fusion and loop scheduling take their choices as plans (data) that a small
`eligible` checks; the scheduling rule is a strategy plan under `executeSync`; a manifest printed with the CUDA
source drives the runtime's gate names. Done; K6's unification holds for the pair.

- Report: [analysis/01-report-fusion-and-scheduling-as-decide-eligible-prepare.md](./analysis/01-report-fusion-and-scheduling-as-decide-eligible-prepare.md)
- Diary: [reference/01-diary.md](./reference/01-diary.md)
- Probes: `scripts/01-schedule-oracle.mjs` (schedules and CUDA hashes of 310 lowerings, recorded on ab23152),
  `scripts/02-schedule-cost.mjs` (scheduling time and pass applications, before and after)

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- tensor

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
