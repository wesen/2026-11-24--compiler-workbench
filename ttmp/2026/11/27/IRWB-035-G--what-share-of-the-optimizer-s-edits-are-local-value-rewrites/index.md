---
Title: What share of the optimizer's edits are local value rewrites
Ticket: IRWB-035-G
Status: active
Topics:
    - compiler
    - verification
    - research
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/analyses.ts
      Note: IMPURE exported for the tree guard
    - Path: repo://src/typed/edit-classes.ts
      Note: the classifier (classifyApplication, instructionWeights, rederive)
    - Path: repo://tests/typed/edit-classes.test.mjs
      Note: its test
ExternalSources: []
Summary: "Edit classifier and the measured share of local value rewrites under O2 and speed."
LastUpdated: 2026-11-27T10:03:49.868654301-05:00
WhatFor: ""
WhenToUse: ""
---

# What share of the optimizer's edits are local value rewrites

## Overview

Task A0 of research programme A: classify every edit the `O2` and `speed` pipelines make on the corpus as a local value rewrite, a structural edit or other, and measure the shares.

Result: local rewrites are 19.5 % of O2's edits and 10.2 % of `speed`'s (31.6 % and 13.9 % of affected instructions); verified rule tables re-derive 46.3 % and 36.3 % of them.

- Design: `design-doc/01-design-classifying-the-optimizer-s-edits-as-local-value-rewrites-structural-edits-or-other.md`
- Report: `reference/02-report-the-share-of-local-value-rewrites-among-the-optimizer-s-edits.md`
- Diary: `reference/01-diary.md`
- Tool: `src/typed/edit-classes.ts`, test `tests/typed/edit-classes.test.mjs`

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- typed

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
