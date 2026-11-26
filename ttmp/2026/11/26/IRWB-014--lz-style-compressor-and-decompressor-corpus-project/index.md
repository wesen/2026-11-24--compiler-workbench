---
Title: LZ-style compressor and decompressor corpus project
Ticket: IRWB-014
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
Summary: ""
LastUpdated: 2026-11-26T11:54:22.668894007-05:00
WhatFor: ""
WhenToUse: ""
---

# LZ-style compressor and decompressor corpus project

## Overview

Design for a single Typed corpus project that compresses and decompresses short byte buffers. The design defines the hash chain, token format, round-trip oracle, input sizes, and RV32 measurement plan.

## Key Links

- [Corpus design](./design-doc/01-lz-style-compressor-and-decompressor-corpus-design.md)
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
