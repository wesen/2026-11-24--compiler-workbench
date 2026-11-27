---
Title: 'F36 and F38: bce compares SSA names, lvn runs twice'
Ticket: IRWB-042-B
Status: active
Topics:
    - compiler
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/passes.ts
      Note: bce compares SSA names through copies (nameOf); lvn refreshes stale seen entries
    - Path: repo://tests/typed/d2-defects.test.mjs
      Note: F36 and F38 todo options removed in this step
ExternalSources: []
Summary: "Fixes two Typed pass defects found by IRWB-037-G: bce now compares the SSA names of index and buffer instead of equal reaching-definition sets (F36), and lvn refreshes a seen entry whose value an earlier merge of the same run rebuilt away instead of throwing absent (F38)."
LastUpdated: 2026-11-27T17:40:48.169271149-05:00
WhatFor: ""
WhenToUse: ""
---

# F36 and F38: bce compares SSA names, lvn runs twice

## Overview

Two small Typed pass defects found by IRWB-037-G ("Found on the way, not changed"), fixed and verified:

- **F36** — `bce` accepted a dominating `i < buf.length` when the index had the same *set* of reaching
  definitions at the branch and at the check; equal sets are not equal values. It now compares **SSA names**,
  resolved through copies (a `typed.ssa` need, replacing `reaching`).
- **F38** — a second `lvn` threw `[absent]`: a merge replaces values and `tx.replace` rebuilds every tree
  around them, so a `seen` entry can name a dead id. `lvn` now refreshes such an entry to the current occurrence.

Report: [reference/02-report.md](./reference/02-report.md). Diary:
[reference/01-implementation-diary.md](./reference/01-implementation-diary.md).

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- typed
- defects

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
