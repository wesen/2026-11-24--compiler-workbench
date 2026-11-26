---
Title: 'Tix on the v6 framework: the language, its IR, f32 and f64 evaluators, a meaning contract and two checked passes'
Ticket: IRWB-020-O
Status: active
Topics:
    - compiler
    - ir
    - verification
    - typescript
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/passes/define-pass.ts
      Note: The framework file the design proposes to change
ExternalSources: []
Summary: "Stage 1 of the tensor domain on the v6 framework: Tix, its IR, f32 and f64 evaluators, a meaning contract, inline and split-sum. Design written, awaiting review."
LastUpdated: 2026-11-26T13:13:43.304305786-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix on the v6 framework: the language, its IR, f32 and f64 evaluators, a meaning contract and two checked passes

## Overview

Stage 1 of a second domain on the v6 framework: tensor programs. The stage delivers Tix (a small index-notation
language), its IR as a v6 artifact in `src/tensor/`, an f32 and an f64 evaluator, a meaning contract with an
exact and a tolerance relation, and the checked passes `inline` and `split-sum`, with a corpus of six programs.
Its purpose is to test the framework: each change to `src/framework/`, with its reason, is the primary result.

Status: the design is written and awaits review. Nothing is implemented.

- Design: [design-doc/01-tix-stage-1-language-ir-evaluators-meaning-contract-inline-and-split-sum.md](./design-doc/01-tix-stage-1-language-ir-evaluators-meaning-contract-inline-and-split-sum.md)
- Diary: [reference/01-diary.md](./reference/01-diary.md)
- Probes: `scripts/01-framework-probes.mjs`, `scripts/02-tolerance-probe.mjs`

Framework changes proposed by the design, both in `src/framework/passes/define-pass.ts`:

1. `applyPassSync`: apply a checked pass synchronously, gated by a caller-supplied check.
2. Open the pass's `IREdit` only when the adapter has `rebuild`.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- ir
- verification
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
