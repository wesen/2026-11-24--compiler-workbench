---
Title: 'F34: honest evidence for recorded checks'
Ticket: IRWB-040-C
Status: complete
Topics:
    - compiler
    - verification
    - ir
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "F34 done: a recorded check carries checked-sampled, checked-exact or plain checked, decided from its evidence."
LastUpdated: 2026-11-27T17:54:31.591378083-05:00
WhatFor: "Reviewing step F34 of IRWB-039"
WhenToUse: "Before merging this branch, or when a later step maps its own method names to assurance"
---

# F34: honest evidence for recorded checks

## Overview

Step F34 of the IRWB-039 framework refactor (design-doc row F34): `AnalysisManager.invariantInternal` stamped every
invariant check `assurance: 'checked'`, and `assuranceOf` called anything that was not `sampled` exact, including no
evidence and a misspelled method. Now a check records `checked-sampled` for sampled differential evidence,
`checked-exact` for `exhaustive`, `exhaustive-32` or `proof`, and plain `checked` for anything else — never exact.

- Diary: [reference/01-implementation-diary-f34-honest-evidence.md](./reference/01-implementation-diary-f34-honest-evidence.md)
- Report: [reference/02-report-f34-honest-evidence-for-recorded-checks.md](./reference/02-report-f34-honest-evidence-for-recorded-checks.md)
- Probe: `scripts/01-assurance-mapping.mjs`

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **complete**

## Topics

- framework
- refactor
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
