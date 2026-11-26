---
Title: 'Sketch: rewrite search on SSA and verified rules (rule discovery, equality saturation, a window superoptimizer)'
Ticket: IRWB-010
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-010--sketch-rewrite-search-on-ssa-and-verified-rules-rule-discovery-equality-saturation-a-window-superoptimizer/design-doc/01-sketch-guide-rewrite-search-on-ssa-and-verified-rules.md
      Note: the sketch guide
    - Path: repo://ttmp/2026/11/26/IRWB-010--sketch-rewrite-search-on-ssa-and-verified-rules-rule-discovery-equality-saturation-a-window-superoptimizer/log/01-sketch-guide-diary.md
      Note: the investigation diary
ExternalSources: []
Summary: 'Sketch ticket: rewrite search on SSA and verified rules. The guide (design-doc 01) explains the system parts, e-graphs, explanations and superoptimization, measures noise3/fbm3 (V-04: 81.8% of a frame; arithmetic 14.5% of noise3), and lists experiments E0-E6 with stop criteria.'
LastUpdated: 2026-11-26T10:24:28.758902169-05:00
WhatFor: ""
WhenToUse: ""
---

# Sketch: rewrite search on SSA and verified rules (rule discovery, equality saturation, a window superoptimizer)

## Overview

A sketch ticket, recorded so the idea is not lost: let the compiler search for better programs (rule discovery by enumeration with the IRWB-006 verifier as the filter, equality saturation over value trees with proof-producing explanations, a window superoptimizer over RV32), aimed at Candela's `noise3` and `fbm3`. Nothing is implemented.

- **Guide:** `design-doc/01-sketch-guide-rewrite-search-on-ssa-and-verified-rules.md` (system parts, background, measurements, design space, experiments E0-E6, open questions).
- **Measured (E0):** in V-04, 81.8 % of a frame's instructions are in the noise family; in `noise3`, arithmetic is 14.5 %, constant rebuilds 21.1 %, register moves 37.0 %; `x * 2.0 -> x + x` would save 0.40 %; multiply-add pairs are 3.9-4.8 % of a frame and inexact (IRWB-011).
- **Diary:** `log/01-sketch-guide-diary.md`.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- ir
- verification
- research

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
