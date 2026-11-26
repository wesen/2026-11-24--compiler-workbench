---
Title: SHA-256 and ChaCha20
Ticket: IRWB-013
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Corpus design for single-block SHA-256 and ChaCha20 optimization workloads."
LastUpdated: 2026-11-26T10:57:50.060730375-05:00
WhatFor: ""
WhenToUse: ""
---

# SHA-256 and ChaCha20

## Overview

Design one corpus project containing single-block SHA-256 and ChaCha20 kernels for checked integer optimization on RV32IMF.

## Key Links

- [Corpus design](./design-doc/01-sha-256-and-chacha20-corpus-project.md)
- [Design diary](./log/01-design-diary.md)

## Status

Current status: **active**

## Topics

- compiler
- ir
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
