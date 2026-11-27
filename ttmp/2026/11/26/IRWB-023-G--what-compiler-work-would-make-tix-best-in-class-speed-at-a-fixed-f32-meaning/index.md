---
Title: 'What compiler work would make Tix best in class: speed at a fixed f32 meaning'
Ticket: IRWB-023-G
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/contract.ts
      Note: The exact and tolerance relations, and the gate tested on the identity
    - Path: repo://src/tensor/cuda-source.ts
      Note: The emitter with the hard-coded schedule the design argues to make explicit
    - Path: repo://src/tensor/evaluate.ts
      Note: The f32 rounding sites that define the meaning
    - Path: repo://ttmp/2026/11/26/IRWB-023-G--what-compiler-work-would-make-tix-best-in-class-speed-at-a-fixed-f32-meaning/design-doc/01-speed-at-a-fixed-meaning.md
      Note: 'The design document: definition, theory, proposals, plan'
    - Path: repo://ttmp/2026/11/26/IRWB-023-G--what-compiler-work-would-make-tix-best-in-class-speed-at-a-fixed-f32-meaning/reference/01-research-diary.md
      Note: Chronological research record including the refuted hypotheses
    - Path: repo://ttmp/2026/11/26/IRWB-023-G--what-compiler-work-would-make-tix-best-in-class-speed-at-a-fixed-f32-meaning/scripts/RESULTS.md
      Note: All measured numbers with the script that produced each
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T21:28:51.405311896-05:00
WhatFor: ""
WhenToUse: ""
---

# What compiler work would make Tix best in class: speed at a fixed f32 meaning

## Overview

A research round on what compiler work would make Tix best in class, with no product changes. The answer is
a definition and four ranked proposals, backed by seven experiments on the GB10.

**Definition.** Best in class means the fastest program at a stated meaning, on the frontier of (throughput
at that meaning, guarantee strength, cost of the evidence, expressiveness per unit of guarantee).

**The finding.** Measured against the stage-2 lowering, bit-exact schedule changes are worth 2.06x on
matmul 512^3, 3.79x on layernorm (248.6 GB/s, the machine's streaming bound) and 1.34x on softmax, with zero
differing output words. A tiled SGEMM with two rounding sites per MAC reaches 10.51 TFLOP/s at 4096^3 =
59% of cuBLAS, bit-identical to the Tix interpreter; the residual 1.70x gap is 1.40x meaning (contraction,
measured 1.87x in the issue rate) and 1.21x schedule. The meaning's largest cost is not the reduction order
but the double-precision transcendental clause: 122x throughput, 45% of softmax.

**Proposals, ranked.** P1 schedule as a checked artifact and searched under a proved trace-neutrality
theorem; P2 a measured price list and a parameterized meaning; P3 check the check - translation validation
plus exhaustive toolchain certificates (0.90 s per intrinsic over all 2^32 f32 inputs); P4 a research bet on
order-independence by exactness, motivated by the finding that the specified fold order is less accurate than
the free alternative.

**Refuted.** Naive per-row fusion loses (0.67x layernorm, 0.34x softmax); a tolerance gate cannot separate
rewrite-induced error from the program's own conditioning.

## Documents

- `design-doc/01-speed-at-a-fixed-meaning.md` - the design document.
- `reference/01-research-diary.md` - chronological research record, failures included.
- `scripts/RESULTS.md` - every measured number with the script that produced it.
- `scripts/01..08` - the seven experiments (four GPU programs, three CPU scripts).

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
