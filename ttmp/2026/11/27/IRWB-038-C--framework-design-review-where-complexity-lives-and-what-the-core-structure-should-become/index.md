---
Title: 'Framework design review: where complexity lives and what the core structure should become'
Ticket: IRWB-038-C
Status: active
Topics:
    - ir
    - compiler
    - research
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T12:54:24.120770816-05:00
WhatFor: ""
WhenToUse: ""
---

# Framework design review: where complexity lives and what the core structure should become

## Overview

A design-level research review of `src/framework/` (R3, Opus cell). Evidence: the merged framework, Typed and Tix
code, four probes in `scripts/`, and 31 unmerged cells (T6, D1, A0, B1) surveyed with spot-checked citations.
No production code was written.

## Key Links

- **Design document:** [design-doc/01-framework-structure-review-composable-parts-layer-assessment-and-migration.md](design-doc/01-framework-structure-review-composable-parts-layer-assessment-and-migration.md)
- **Diary:** [reference/01-diary.md](reference/01-diary.md)
- **Probes:** `scripts/01-tix-correspondence-and-runners.mjs`, `scripts/02-sampled-check-assurance.mjs`,
  `scripts/03-framework-usage-census.mjs`, `scripts/04-bta-on-the-existing-solver.mjs` (each with `.out.txt`;
  run from the worktree root after `npm run build`)

## Status

Complete: design document and diary committed. Not pushed.
