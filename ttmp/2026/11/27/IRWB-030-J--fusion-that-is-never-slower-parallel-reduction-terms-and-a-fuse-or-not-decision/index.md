---
Title: 'Fusion that is never slower: parallel reduction terms and a fuse-or-not decision'
Ticket: IRWB-030-J
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-source.ts
      Note: Term phase, ordered fold and terms row buffer in the group emitter
    - Path: repo://src/tensor/fusion.ts
      Note: Term-staging and decline decisions with recorded reasons
    - Path: repo://tests/tensor/parallel-terms-gpu.test.mjs
      Note: GB10 tests of staged terms, declined groups and the fold-order mutant
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T01:32:51.449549391-05:00
WhatFor: ""
WhenToUse: ""
---

# Fusion that is never slower: parallel reduction terms and a fuse-or-not decision

## Overview

<!-- Provide a brief overview of the ticket, its goals, and current status -->

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
