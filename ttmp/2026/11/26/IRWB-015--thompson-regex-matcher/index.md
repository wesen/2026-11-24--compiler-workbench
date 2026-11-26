---
Title: Thompson regex matcher
Ticket: IRWB-015
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
Summary: "Design for a bounded Thompson-NFA optimization corpus project."
LastUpdated: 2026-11-26T10:58:04.475975588-05:00
WhatFor: ""
WhenToUse: ""
---

# Thompson regex matcher

## Overview

The design specifies a Typed matcher with explicit Thompson-NFA state sets, a JavaScript RegExp oracle, and a checked RV32 instruction-count baseline.

## Key Links

- [Corpus design](./design-doc/01-thompson-regex-matcher-corpus-design.md)
- [Diary](./log/01-diary.md)
- [Feature probe](./scripts/01-probe.mjs)

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
