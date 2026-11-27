---
Title: Deriving streaming attention by checked rewrites
Ticket: IRWB-021-Q
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
    - Path: repo://src/framework/contracts/definitions.ts
      Note: defineInvariant/defineTransformation and proof-record assurance the lemma certificates ride on
    - Path: repo://src/framework/contracts/differential.ts
      Note: Sampled differential invariant mechanism the tix.meaning-within/exact contracts are built on
    - Path: repo://src/framework/ir/PATTERNS-AND-REWRITES.md
      Note: Schedule semantics and evidence model the derivation runs through
    - Path: repo://src/framework/ir/patterns.ts
      Note: Pattern/predicate registry used for the syntactic side-condition guards
    - Path: repo://src/framework/ir/rewrites.ts
      Note: Rule application machinery (guards, preserves, per-step transactional evidence) the six rules use
    - Path: repo://src/typed/evaluate.ts
      Note: Typed meaning contract (cases, seeds, cached keys) that the Tix contract design follows
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T21:41:11.070184728-05:00
WhatFor: ""
WhenToUse: ""
---

# Deriving streaming attention by checked rewrites

## Overview

IRWB-021-Q asks whether a compiler can **derive** FlashAttention's streaming form from the
plain N×N-materializing Tix attention program as a sequence of rewrites, each checked with a
local and mechanical correctness argument. This ticket is a research design (no
implementation): it settles the rule set with side conditions and real-arithmetic lemmas, the
`fold` extension Tix needs (record state, pure step, certificate-checked associative combine),
the per-step checking architecture (syntactic side conditions + lemma dossiers + sampled
tolerance against an f64 reference, with a step-0 gate and exact `m`-component spot-checks),
the full P0→P4 derivation, the generality and failure bounds of the rule set, and the GB10
experiment (DRAM-traffic scaling, time vs a hand-written kernel, mutation-measured checker
strength).

The design document is
[design-doc/01-design-deriving-flashattention-from-plain-tix-by-checked-rewrites.md](./design-doc/01-design-deriving-flashattention-from-plain-tix-by-checked-rewrites.md);
the diary records the design decisions and the alternatives considered.

Current status: **active** (design written; implementation is Later, item by item in §9 of
the design).

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
