---
Title: Bytecode VM
Ticket: IRWB-012
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
Summary: Design ticket for a Typed bytecode interpreter and specialization playground.
LastUpdated: 2026-11-26T10:58:07.489968897-05:00
WhatFor: ""
WhenToUse: ""
---

# Bytecode VM

## Overview

Design a compact Typed stack machine that runs seeded Fibonacci and a rolling checksum. The design specifies the bytecode image, JavaScript oracle, loader wiring, and general and hand-specialized RV32 comparisons.

## Key Links

- [VM design](design-doc/01-a-stack-machine-bytecode-vm-for-specialization.md)
- [Design diary](log/01-design-diary.md)

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
