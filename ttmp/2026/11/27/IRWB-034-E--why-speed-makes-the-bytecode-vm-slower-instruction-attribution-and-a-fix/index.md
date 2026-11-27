---
Title: 'Why speed makes the bytecode VM slower: instruction attribution and a fix'
Ticket: IRWB-034-E
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/analyses.ts
      Note: the same-header loop merge in loopsOf
    - Path: repo://src/typed/attribute.ts
      Note: the attribution tool (attributeSteps, attributeOrigins)
    - Path: repo://tests/typed/attribution.test.mjs
      Note: the tool's test, pinning the fixed world
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:44:14.43959739-05:00
WhatFor: ""
WhenToUse: ""
---

# Why speed makes the bytecode VM slower: instruction attribution and a fix

## Overview

Why the `speed` pipeline made the bytecode VM slower than r0, found by
crediting executed RV32 instructions to pass decisions through the
compiler's own records (emulator counts, `covers`, correspondence, edits);
the fix (merging same-header natural loops in `loopsOf`) and the reusable
attribution tool (`src/typed/attribute.ts`).

## Key Links

- [Design](design-doc/01-attribution-of-executed-instructions-to-pass-decisions-and-the-licm-preheader-fix.md)
- [Final report](report/01-final-report-the-attribution-the-fix-and-the-measurements.md)
- [Implementation diary](diary/01-implementation-diary.md)
- Scripts and their outputs: [scripts/](scripts/)
- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- ir
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
