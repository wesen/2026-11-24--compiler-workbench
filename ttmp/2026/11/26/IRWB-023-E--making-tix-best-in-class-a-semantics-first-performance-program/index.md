---
Title: 'Making Tix best in class: a semantics-first performance program'
Ticket: IRWB-023-E
Status: active
Topics:
    - compiler
    - ir
    - verification
    - tensor
    - numerics
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: abs:///home/manuel/code/wesen/2026-11-24--compiler-workbench/src/tensor/contract.ts
      Note: Sampled case recipe and the 2e-6+2e-5|r| budget under audit
    - Path: abs:///home/manuel/code/wesen/2026-11-24--compiler-workbench/src/tensor/cuda-source.ts
      Note: One kernel per statement, one thread per element, no contraction
    - Path: abs:///home/manuel/code/wesen/2026-11-24--compiler-workbench/src/tensor/evaluate.ts
      Note: The exact f32 meaning every pass is judged against
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T21:36:12.096934514-05:00
WhatFor: ""
WhenToUse: ""
---

# Making Tix best in class: a semantics-first performance program

## Overview

<!-- Provide a brief overview of the ticket, its goals, and current status -->

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- ir
- verification
- tensor
- numerics

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

# IRWB-023-E — Numerics as a resource

Research round: design and experiment only, no product code changed.

- [Design document](design-doc/01-numerics-as-a-resource.md) — what "best in class" should mean for
  Tix, five ranked proposals each with theory, evidence, risks, success measures and framework
  requirements, a staged plan, and the negative results.
- [Implementation diary](reference/01-implementation-diary.md) — reading, six experiments, the two
  hypotheses that were refuted and the two that were right for unexpected reasons.
- `scripts/02-contract-audit.mjs`, `scripts/03-fast-lowering.mjs`, `scripts/probe*/` — replayable
  experiments.

Short version: the merged system pays for exactness in the two places where it is expensive
(transcendentals: 2.7×, `tanh` 6.0×; reduction order: 9.2× and 17.7× *less* accurate) and pays
nothing for it where the money is (a bit-identical register-blocked matmul schedule is 1.54–1.85×
faster at 0 differing words). The tolerance contract is simultaneously too loose (it accepted a
1.47×-faster transcendental change using 0.000 of its budget) and too tight (the *specified* f32
matmul is 4.36× outside it at 512³), because it is calibrated on tensors of at most 49 elements.
