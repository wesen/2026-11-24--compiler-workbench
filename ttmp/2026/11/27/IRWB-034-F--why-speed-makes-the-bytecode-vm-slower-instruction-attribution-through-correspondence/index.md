---
Title: 'Why speed makes the bytecode VM slower: instruction attribution through correspondence'
Ticket: IRWB-034-F
Status: active
Topics:
    - compiler
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/attribution.ts
      Note: the attribution
    - Path: repo://src/typed/passes.ts
      Note: the licm fix
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:00:06.794523226-05:00
WhatFor: ""
WhenToUse: ""
---

# Why speed makes the bytecode VM slower: instruction attribution through correspondence

## Overview

Why the `speed` pipeline made the bytecode VM slower (licm treated a loop head with nine back edges as nine
loops and put the preheader on the back edges), the instruction attribution that found it from the compiler's
records (`src/typed/attribution.ts`), and the fix in licm (`loopsByHead`).

- Design: [design-doc/01](./design-doc/01-instruction-attribution-through-correspondence-and-the-licm-fix-for-loops-that-share-a-head.md)
- Report: [analysis/01](./analysis/01-report-why-speed-made-the-bytecode-vm-slower-and-the-fix.md)
- Diary: [reference/01](./reference/01-diary.md)
- Scripts and their outputs: `scripts/`, `scripts/results/`

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **review**

## Topics

- compiler
- performance

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
