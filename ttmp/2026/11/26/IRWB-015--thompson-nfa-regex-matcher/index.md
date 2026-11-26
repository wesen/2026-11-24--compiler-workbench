---
Title: Thompson NFA regex matcher
Ticket: IRWB-015
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
Summary: Design for a checked Thompson NFA matcher and a fixed-pattern specialization workload.
LastUpdated: 2026-11-26T11:54:18.893250185-05:00
WhatFor: ""
WhenToUse: ""
---

# Thompson NFA regex matcher

## Overview

The corpus project will compile a bounded pattern buffer to a Thompson NFA in frame arrays and match ASCII text with explicit state sets. The design specifies the state layout, independent RegExp oracle, check budget and corpus integration.

## Key Links

- [Design document](design-doc/01-thompson-nfa-regex-matcher.md)
- [Diary](log/01-diary.md)

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

- design-doc/ - Architecture and design documents
- log/ - Design diary
- reference/ - Prompt packs, API contracts, context summaries
- playbooks/ - Command sequences and test procedures
- scripts/ - Temporary code and tooling
- various/ - Working notes and research
- archive/ - Deprecated or reference-only artifacts
