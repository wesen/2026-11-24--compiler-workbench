---
Title: Deriving streaming attention by checked rewrites
Ticket: IRWB-021
Status: active
Topics:
    - research
    - compiler
    - verification
    - ir
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Research design: five checked rewrite rules (plus one optional) and one Tix construct that carry the plain O(N^2) Tix attention program to the streaming O(N*D) form, with per-rule real-arithmetic obligations, measured f32 deviations, a tolerance relation scaled by the problem conditioning, the programs the rules reach and fail on, and a falsifiable GB10 experiment."
LastUpdated: 2026-11-26T21:40:22.131799414-05:00
WhatFor: "Before implementing a Tix pass that derives streaming kernels, or generalising the framework contracts to a second domain with a tolerance relation."
WhenToUse: "When asked whether the compiler can derive FlashAttention, what Tix lacks for it, or how a non-bit-exact rewrite chain can be checked in this framework."
---

# Deriving streaming attention by checked rewrites

## Overview

Research design, no implementation. Can a compiler derive FlashAttention from the plainly written Tix
attention program as a sequence of *checked* rewrites, each with a local, mechanical correctness argument?

The answer designed here: **five rewrites plus one optional**, of which two are bit-exact in f32 (fusion and
de-materialisation) and three change the f32 result (hoisting, the running maximum, tiling); **one new
construct in Tix** — a reduction whose state is a tuple of tensors with an explicit combine expression,
*left*-folded in index order so that `sum` and `max` are instances and the core's meaning is unchanged; a
**tolerance relation** scaled by the conditioning of the problem (`u·(4 + max|s|)`) because no bit-exact
derivation exists, with its constants fitted to three f32 probes; and a **falsifiable GB10 experiment** with
three hypotheses and stated refutation criteria.

Two measured findings shaped the design and are the parts worth arguing with:

- the memory win is numerically free — removing the N×N intermediates changes no bit — and the N×N tensor
  exists only because the maximum and the weighted sum are two passes over `j`;
- the error contribution of the running maximum is **not** proportional to the number of rescalings (the
  working hypothesis, refuted by `scripts/02-rescale-count.mjs`); it is common-mode in `ν/λ`.

## Key Links

- Design: [design-doc/01-deriving-streaming-attention-by-checked-rewrites.md](./design-doc/01-deriving-streaming-attention-by-checked-rewrites.md)
- Diary: [reference/01-irwb-021-diary.md](./reference/01-irwb-021-diary.md)
- Probes: [scripts/](./scripts) and their outputs in [various/](./various)
- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- research
- compiler
- verification
- ir

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
