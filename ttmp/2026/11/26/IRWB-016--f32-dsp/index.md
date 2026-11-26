---
Title: f32 DSP
Ticket: IRWB-016
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
Summary: Design for one Typed corpus project with an FFT and a three-channel biquad bank.
LastUpdated: 2026-11-26T11:54:29.012596624-05:00
WhatFor: ""
WhenToUse: ""
---

# f32 DSP

## Overview

Design for one Typed corpus project with an iterative radix-2 FFT and a three-channel biquad bank. The design defines the input layout, exact checks, float64 accuracy bound and RV32 measurement plan.

## Key Links

- [Design document](./design-doc/01-f32-dsp-corpus-program.md)
- [Design diary](./log/01-diary.md)
- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

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
