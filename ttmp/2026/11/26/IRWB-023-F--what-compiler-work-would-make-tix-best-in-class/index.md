---
Title: What compiler work would make Tix best in class
Ticket: IRWB-023-F
Status: active
Topics:
    - compiler
    - ir
    - verification
    - gpu
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T21:32:26.246621487-05:00
WhatFor: ""
WhenToUse: ""
---

# What compiler work would make Tix best in class

## Overview

A research round: no product code changed. It asks what compiler work would make
Tix best in class, defines that phrase on two axes (guarantee strength and the
*price* of the guarantee), and ranks five proposals backed by four experiments on
the GB10.

The short version, all measured this round:

- A 4x4 register tile over the *same* sequential fold takes matmul 512^3 from
  0.2068 ms to 0.1027 ms with **zero** differing output words; an ordinary
  four-accumulator unroll buys 12% more and changes **93.5%** of outputs. The price
  of exactness at that shape is at most 14%, not 6x.
- The specified meaning costs a **double-precision** `exp` per element; `expf` is
  2.7x faster and wrong on 37.5% of softmax outputs. All 2^32 f32 inputs can be
  swept in about one second, so this layer can be *proved*, not sampled.
- The `2e-6 + 2e-5|r|` tolerance is not scale-invariant: the honest f32 evaluation
  of matmul exceeds it by 1.62x at K=256 and 3.65x at K=1024, while the gate only
  samples extents 1, 3, 4, 7.
- The shipped lowering check **accepts** a lowering that drops the last k step for
  every reduction of length >= 8 (error at extent 16: 4018x the budget).

Deliverables: [design document](./design-doc/01-speed-under-exactness-a-research-agenda-for-tix.md)
(five ranked proposals, staged plan, failures) and [research diary](./reference/01-research-diary.md).
Raw experiment output is in `reference/experiment-0*.{json,txt}`; probes are in
`scripts/` and `prototypes/`.

## Key Links

- [Design: speed under exactness](./design-doc/01-speed-under-exactness-a-research-agenda-for-tix.md)
- [Research diary](./reference/01-research-diary.md)
- Experiment drivers: `scripts/01-schedule-probe.mjs`, `scripts/02-transcendental-probe.mjs`,
  `scripts/03-tolerance-and-coverage.mjs`, `scripts/04-gate-evasion.mjs`
- Prototypes: `prototypes/01-schedule/main.cu`, `prototypes/02-transcendental/main.cu`
- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- ir
- verification
- gpu

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
