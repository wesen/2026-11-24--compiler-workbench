---
Title: Lowering Tix to CUDA, checked on the GPU machine
Ticket: IRWB-022-E
Status: active
Topics:
    - compiler
    - ir
    - verification
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T15:12:17.615045946-05:00
WhatFor: ""
WhenToUse: ""
---

# Lowering Tix to CUDA, checked on the GPU machine

## Overview

Stage 2 tests the framework with a remote, asynchronous check of Tix-to-CUDA lowering. The backend emits CUDA directly from checked Tix IR and checks the emitted artifact on the GB10. The framework source did not need changes.

## Key Links

- [Design: Direct CUDA emission and batched lowering checks](./design-doc/01-direct-cuda-emission-and-batched-lowering-checks.md)
- [Implementation diary and probe evidence](./reference/01-implementation-diary.md)
- [Final report and independent evaluation](./reference/02-report.md)
- [Verification and corpus timings](./reference/02-cuda-verification-and-corpus-timings.md)

## Status

Current status: **active**

## Topics

- compiler
- ir
- verification
- performance

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.

## Structure

The `scripts/` directory contains reproducible design probes, not the backend implementation.
