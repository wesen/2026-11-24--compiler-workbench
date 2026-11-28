---
Title: One pass runner with two drivers
Ticket: IRWB-051-A
Status: active
Topics:
    - framework
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T20:19:49.008881472-05:00
WhatFor: ""
WhenToUse: ""
---

# One pass runner with two drivers

## Overview

Phase 3 spike for a shared transformation lifecycle with synchronous and asynchronous drivers. The prototype ports Tix inline and Typed constant propagation alongside the current entry points.

## Evidence

- [Design](design-doc/01-runner-spike-design.md)
- [Diary](log/01-diary.md)
- [Report](analysis/01-spike-report.md)
- [Timing and size probe](scripts/01-measure-drivers.mjs)

## Status

Current status: **active**

## Topics

- framework

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
