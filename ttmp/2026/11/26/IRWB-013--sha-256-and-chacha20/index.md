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
Summary: "Design ticket for a SHA-256 and ChaCha20 optimization corpus project."
LastUpdated: 2026-11-26T10:34:46.05183675-05:00
WhatFor: ""
WhenToUse: ""
---

# SHA-256 and ChaCha20

## Overview

The design defines a single Typed corpus project for studying integer rewrites, loop optimization, specialization and register allocation with SHA-256 and ChaCha20.

## Key Links

- [Corpus project design](design-doc/01-sha-256-and-chacha20-corpus-project.md)
- [Design diary](log/01-diary.md)

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

- design-doc/ - Architecture and design documents
- log/ - Design diary
- reference/ - Prompt packs, API contracts, context summaries
- playbooks/ - Command sequences and test procedures
- scripts/ - Temporary code and tooling
- various/ - Working notes and research
- archive/ - Deprecated or reference-only artifacts
