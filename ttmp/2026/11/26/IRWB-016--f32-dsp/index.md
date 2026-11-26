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
Summary: Design for one f32 DSP corpus project with a radix-2 FFT and a biquad bank.
LastUpdated: 2026-11-26T10:34:35.944954412-05:00
WhatFor: ""
WhenToUse: ""
---

# f32 DSP

## Overview

This ticket designs a small Typed DSP workload for exact compiler passes, specialization on input data, and future tolerance-checked f32 optimizations.

## Key Links

- [f32 DSP corpus project design](design-doc/01-f32-dsp-corpus-project.md)
- [Design diary](log/01-diary.md)

## Status

The design is ready for implementation.

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
