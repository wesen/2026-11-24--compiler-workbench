---
Title: 'Fusion that is never slower: parallel terms, serial fold, and a cost gate'
Ticket: IRWB-030-E
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Check on both sides of the gate
    - Path: repo://src/tensor/cuda-source.ts
      Note: 'Emitter: term pass, templated block kernel, host gate'
    - Path: repo://src/tensor/fusion.ts
      Note: 'Plan: terms, inPlace, heavy, gate'
    - Path: repo://tests/tensor/terms-gpu.test.mjs
      Note: GB10 tests of this stage
ExternalSources: []
Summary: Stage 3b of Tix on the v6 framework. Staged reduction terms with a serial fold, in-place rows and a launch-time gate make the fused CUDA lowering faster than stage 2 on the corpus and the inside variants, bit-identical; no framework change.
LastUpdated: 2026-11-27T01:22:37.75459487-05:00
WhatFor: Entry point of the ticket
WhenToUse: Finding the design, diary, report and scripts of IRWB-030-E
---

# Fusion that is never slower: parallel terms, serial fold, and a cost gate

## Overview

Stage 3b of the tensor domain: make checked fusion never slower than the unfused lowering. Done: the design (`design-doc/01-…`), the implementation in `src/tensor/`, tests in `tests/tensor/`, measurements in `scripts/` (numbered in the order written, outputs beside them), the diary (`reference/01-…`) and the final report (`reference/02-…`).

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- tensor
- gpu
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
