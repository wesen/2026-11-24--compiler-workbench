---
Title: 'Gate strength: a mutation score for the meaning contract and stronger case generation'
Ticket: IRWB-005
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/cases-strong.ts
      Note: contract version 2 (D2b)
    - Path: repo://src/typed/facts-check.ts
      Note: C5 range facts against executions
    - Path: repo://src/typed/mutate.ts
      Note: mutation operators and the mutant pass (D2a)
    - Path: repo://tools/mutation-classify.mjs
      Note: equivalent-mutant classification cascade
    - Path: repo://tools/mutation-score-candela.mjs
      Note: Candela subset on sub-programs with an overlay store
    - Path: repo://ttmp/2026/11/25/IRWB-005--gate-strength-a-mutation-score-for-the-meaning-contract-and-stronger-case-generation/log/01-gate-strength-diary.md
      Note: investigation diary
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-25T23:07:55.009760973-05:00
WhatFor: ""
WhenToUse: ""
---

# Gate strength: a mutation score for the meaning contract and stronger case generation

## Overview

How often does the meaning contract (`typed.meaning-kept@1`, 40 cases per function, seed 7) reject a wrong pass? Measured with mutants planted by an ordinary pass (`src/typed/mutate.ts`, ten operators) and judged through `Program.apply`, with every surviving mutant classified as wrong or equivalent (`tools/mutation-classify.mjs`). A stronger, opt-in contract version 2 (`src/typed/cases-strong.ts`: boundary cases, records at their offsets, a divergence rule) is measured against it. The default contract is frozen and verified identical (`various/18-freeze-diff.txt`).

Results so far: corpus head 1,144 mutants, default 95.8 % of non-equivalent mutants killed, version 2 99.8 %; r0 base 96.2 % / 99.9 %; f32 fixture 96.7 % / 100 %. Intern guide: `design-doc/01-…`; diary: `log/01-gate-strength-diary.md`.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- ir
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
