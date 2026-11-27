---
Title: 'Best in class for Tix: certified-numerics performance and priced relaxation'
Ticket: IRWB-023-I
Status: active
Topics:
    - compiler
    - verification
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-source.ts
      Note: Emitter the schedule tier extends
    - Path: repo://ttmp/2026/11/26/IRWB-023-I--best-in-class-for-tix-certified-numerics-performance-and-priced-relaxation/design-doc/01-best-in-class-for-tix-certified-numerics-performance-and-priced-relaxation.md
      Note: Design document with measured results
    - Path: repo://ttmp/2026/11/26/IRWB-023-I--best-in-class-for-tix-certified-numerics-performance-and-priced-relaxation/reference/01-research-diary-experiments-decisions-and-failures.md
      Note: Research diary with evidence and failures
    - Path: repo://ttmp/2026/11/26/IRWB-023-I--best-in-class-for-tix-certified-numerics-performance-and-priced-relaxation/scripts/05-gpu-bench.mjs
      Note: GB10 bench generator and driver
ExternalSources: []
Summary: Certified throughput as the best-in-class criterion for Tix; measured exact-tier and budget-tier prototype schedules on the GB10; staged plan and refuted hypotheses.
LastUpdated: 2026-11-26T23:15:20.300481386-05:00
WhatFor: ""
WhenToUse: ""
---

# Best in class for Tix: certified-numerics performance and priced relaxation

## Overview

Research round (design + experiment, no product changes). The design document defines **certified throughput** — kernel speed achieved while a machine-checked relation to Tix's exactly specified f32 meaning holds — as the best-in-class criterion, and proposes a schedule tier with provably exact schedule passes, numerical budgets as a first-class compilation target, and static exactness certificates, each backed by GB10 experiments run in this ticket's `scripts/` and `prototype/`. The diary records the full loop including failures.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- verification
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
