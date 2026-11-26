---
Title: LZ-style compressor and decompressor
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
Summary: Design for a bounded LZ codec as a Typed optimization workload.
LastUpdated: 2026-11-26T10:57:57.090407112-05:00
WhatFor: ""
WhenToUse: ""
---

# LZ-style compressor and decompressor

## Overview

Design a new Typed corpus project that exercises relational bounds checks, loop-carried memory dependencies, and integer rewrites. The round-trip oracle compares decoded cells directly with the original input.

## Key Links

- [LZ-style compression corpus project](./design-doc/01-lz-style-compression-corpus-project.md)
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
