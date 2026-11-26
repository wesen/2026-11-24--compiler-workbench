---
Title: Deriving streaming attention by checked rewrites
Ticket: IRWB-021-K
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Research design for deriving and checking streaming attention in Tix.
LastUpdated: 2026-11-26T12:54:46.875607262-05:00
WhatFor: Locate the derivation, numerical contract, and GB10 experiment.
WhenToUse: When reviewing the proposal or preparing to run the study.
---

# Deriving streaming attention by checked rewrites

## Overview

Can the compiler derive a tiled, one-pass attention kernel from plain Tix through locally checked rewrites? This ticket specifies the derivation and how to test it. It contains no implementation or GPU results.

- [Research design](design-doc/01-deriving-streaming-attention-by-checked-rewrites.md)
- [Diary](analysis/01-diary.md)

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.
