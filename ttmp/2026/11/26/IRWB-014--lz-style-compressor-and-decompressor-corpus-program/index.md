---
Title: LZ-style compressor and decompressor corpus program
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
Summary: "Design for a Typed LZ-style corpus benchmark with hash chains, packed tokens and exact round-trip checks."
LastUpdated: 2026-11-26T10:34:45.63353658-05:00
WhatFor: ""
WhenToUse: ""
---

# LZ-style compressor and decompressor corpus program

## Overview

Design a Typed corpus benchmark that exercises relational bounds proofs,
loop-carried state and integer rewrites. The guide specifies the wire
format, test cases, pass budget and RV32 measurements for implementation.

## Key Links

- [Codec design and implementation plan](./design-doc/01-designing-an-lz-style-compressor-and-decompressor-for-the-corpus.md)
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
