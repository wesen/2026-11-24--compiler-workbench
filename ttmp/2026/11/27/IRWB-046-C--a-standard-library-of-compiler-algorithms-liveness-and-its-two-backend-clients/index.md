---
Title: 'A standard library of compiler algorithms: liveness, and its two backend clients'
Ticket: IRWB-046-C
Status: active
Topics:
    - stdlib
    - framework
    - liveness
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/stdlib/flow/liveness.ts
      Note: 'the liveness primitive: backward gen/kill with an explicit scope'
    - Path: repo://src/stdlib/index.ts
      Note: the library's index, layers, admission rule and later modules
    - Path: repo://src/typed/backend/coalesce.ts
      Note: interference edges built in walkBackwards
    - Path: repo://src/typed/backend/regalloc.ts
      Note: machineLiveness; intervals() without its own sweep
    - Path: repo://tests/stdlib/imports.test.mjs
      Note: no import outside src/stdlib, the layers, the index
    - Path: repo://tests/stdlib/liveness.test.mjs
      Note: the primitive, the unreachable block under both scopes, a search reference
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T18:44:03.384952614-05:00
WhatFor: ""
WhenToUse: ""
---

# A standard library of compiler algorithms: liveness, and its two backend clients

## Overview

<!-- Provide a brief overview of the ticket, its goals, and current status -->

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- stdlib
- framework
- liveness

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
