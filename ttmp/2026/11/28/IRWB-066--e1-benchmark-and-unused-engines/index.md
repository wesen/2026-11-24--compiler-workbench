---
Title: E1 benchmark and unused engines
Ticket: IRWB-066
Status: active
Topics:
    - framework
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: E1 measurements and the extraction of unused engines to labs.
LastUpdated: 2026-11-28T03:39:31.565407628-05:00
WhatFor: ""
WhenToUse: ""
---

# E1 benchmark and unused engines

## Overview

Compare incremental checking with the existing manager and with the query runtime. The runtime reduces some per-edit costs but fails the size-scaling gate. Labs now own the query runtime, graph patterns, and rewrite scheduler. The framework retains traversal and transactions used by its shared IR APIs.

## Key Links

- [Measurement design](design-doc/01-e1-measurement-design.md)
- [Diary](reference/01-diary.md)
- [Results and engine disposition](reference/02-e1-results-and-engine-disposition.md)
- [Benchmark](scripts/01-e1.mjs)

## Status

Current status: **active**

## Topics

- framework
- performance

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.
