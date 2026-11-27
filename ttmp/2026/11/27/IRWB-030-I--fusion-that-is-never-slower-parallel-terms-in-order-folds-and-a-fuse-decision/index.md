---
Title: 'Fusion that is never slower: parallel terms, in-order folds, and a fuse decision'
Ticket: IRWB-030-I
Status: active
Topics:
    - tensor
    - gpu
    - framework
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-source.ts
      Note: term phase and in-order fold in emitGroup
    - Path: repo://src/tensor/fusion.ts
      Note: planFusion decides groups and term staging
    - Path: repo://src/tensor/index.ts
      Note: runTixCuda passes launch shape values
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T01:25:03.164086018-05:00
WhatFor: ""
WhenToUse: ""
---

# Fusion that is never slower: parallel terms, in-order folds, and a fuse decision

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
- framework

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
