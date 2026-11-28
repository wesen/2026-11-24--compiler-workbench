---
Title: 'stdlib/num: binary32 arithmetic with an explicit min/max profile'
Ticket: IRWB-050-B
Status: active
Topics:
    - compiler
    - ir
    - typescript
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/stdlib/index.ts
      Note: re-exports and the num/ line
    - Path: repo://src/stdlib/num/binary32.ts
      Note: binary32 as bit patterns, the operation set
    - Path: repo://src/stdlib/num/minmax.ts
      Note: the min/max rule and the two profile names
    - Path: repo://src/tensor/evaluate.ts
      Note: the Tix client, minimum, Math.max deleted
    - Path: repo://src/typed/f32.ts
      Note: the RV32F client, minimumNumber
    - Path: repo://tests/stdlib/num.test.mjs
      Note: both profiles, both representations, both clients
ExternalSources: []
Summary: 'src/stdlib/num: binary32 arithmetic with min/max under a named IEEE 754-2019 profile; Typed on minimumNumber, Tix on minimum, byte-identical baselines.'
LastUpdated: 2026-11-27T21:17:42.944319902-05:00
WhatFor: ""
WhenToUse: ""
---

# stdlib/num: binary32 arithmetic with an explicit min/max profile

## Overview

IRWB-039 phase 2: move binary32 arithmetic into `src/stdlib/num/`, with the operation IEEE 754-2019 leaves open —
min and max — chosen by name at each call site instead of defaulted. Typed computes RV32F's `minimumNumber`/
`maximumNumber` (a NaN loses, so `max(NaN, 7)` is 7); Tix computes JavaScript's `minimum`/`maximum` (a NaN propagates).
Both call the library, both keep their behaviour, and every baseline stays byte-identical.

Start with the design doc (the profile rule, the representations, and the alternatives), then the report.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active** — the step is complete; its acceptance numbers are in the report.

## Topics

- compiler
- ir
- typescript
- stdlib

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
