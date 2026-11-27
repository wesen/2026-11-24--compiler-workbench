---
Title: Specialize the bytecode VM on constant memory
Ticket: IRWB-036-A
Status: complete
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
LastUpdated: 2026-11-27T10:18:31.101855376-05:00
WhatFor: ""
WhenToUse: ""
---

# Specialize the bytecode VM on constant memory

## Overview

The checked Typed specializer turns the two fixed bytecode programs into direct RV32 loops. At count 12 and seed 8, the automatic versions execute 161 and 136 instructions in 64 and 52 code bytes.

## Key Links

- [Design](design-doc/01-residualize-typed-control-flow-with-a-constant-buffer.md)
- [Final report](analysis/01-bytecode-vm-specialization-measurements.md)
- [Implementation diary](log/01-implementation-diary.md)

## Status

Current status: **active**

## Topics



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
