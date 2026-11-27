---
Title: 'Two Typed pass defects: bce by value, lvn''s absent value'
Ticket: IRWB-042-C
Status: active
Topics:
    - compiler
    - typed
    - passes
    - framework-v7
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T17:28:01.848054258-05:00
WhatFor: ""
WhenToUse: ""
---

# Two Typed pass defects: bce by value, lvn's absent value

## Overview

Two Typed pass defects that IRWB-037-G found and left unchanged, fixed in one session:

- **F36, `bce`:** it accepted a dominating `i < buf.length` as proof when the index had the same *set* of reaching
  definitions at the branch and at the check. Equal sets are not equal values. It now compares the SSA names of
  the two reads; the corpus keeps all 13 bounds-check eliminations (see `reference/02`).
- **F38, `lvn`:** run a second time before `rotate` on regex-nfa it threw `absent`: it replaced a value that a
  firing of the same block had already rebuilt. It now drops the `seen` entries whose value a firing rebuilds.

Both `todo` tests in `tests/typed/d2-defects.test.mjs` pass, the baselines report `no differences`, and the four
passing suites file by file are in the report. F37 (`typed.ranges`) is another ticket (IRWB-043-A).

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- typed
- passes
- framework-v7

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
