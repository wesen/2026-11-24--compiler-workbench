---
Title: 'stdlib/affine: exact affine forms and dependence distance vectors'
Ticket: IRWB-049-A
Status: complete
Topics:
    - compiler
    - refactor
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/stdlib/index.ts
      Note: the library index now exports the affine module
    - Path: repo://tests/stdlib/affine.test.mjs
      Note: 'the module''s tests: exactness, R3''s case, distances, joinDepth as the second client'
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T21:15:55.735924055-05:00
WhatFor: ""
WhenToUse: ""
---

# stdlib/affine: exact affine forms and dependence distance vectors

## Overview

Library extraction with a correctness fix (IRWB-039 phase 2b): the affine forms moved from
`src/tensor/model.ts` into `src/stdlib/affine/forms.ts`, with `add` now exact (BigInt coefficients;
R3's rounding case fixed). `src/stdlib/affine/distances.ts` adds dependence distance vectors, and
fusion's `joinDepth` is rewritten on them — its join test is the leading positions at which every
read has distance zero. Baselines byte-identical; all non-GPU suites pass. See the report
(`reference/02-report-the-affine-module-exact-forms-and-distances.md`) and the diary
(`reference/01-implementation-diary.md`).

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **complete**

## Topics

- compiler
- refactor
- verification

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
