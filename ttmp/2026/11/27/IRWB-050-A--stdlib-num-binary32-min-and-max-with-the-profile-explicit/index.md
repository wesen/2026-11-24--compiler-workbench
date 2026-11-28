---
Title: 'stdlib num: binary32 min and max with the profile explicit'
Ticket: IRWB-050-A
Status: complete
Topics:
    - compiler
    - ir
    - typescript
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/stdlib/num/minmax.ts
      Note: the num module's first primitive, the min/max family with the profile as the operation name
    - Path: repo://src/tensor/evaluate.ts
      Note: second client, the ops table and the max reduction name the JavaScript profile
    - Path: repo://src/typed/f32.ts
      Note: first client, fmin/fmax across the bits-number boundary, the old order/minmax helpers deleted
    - Path: repo://tests/stdlib/minmax.test.mjs
      Note: each operation on the special values in both orders, plus both clients through their own representations
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T21:03:49.892791811-05:00
WhatFor: ""
WhenToUse: ""
---

# stdlib num: binary32 min and max with the profile explicit

## Overview

<!-- Provide a brief overview of the ticket, its goals, and current status -->

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
