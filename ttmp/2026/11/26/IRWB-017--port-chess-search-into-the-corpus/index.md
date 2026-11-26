---
Title: Port chess search into the corpus
Ticket: IRWB-017
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
Summary: Design for porting the existing Typed chess engine into the checked optimization corpus.
LastUpdated: 2026-11-26T10:34:29.75259685-05:00
WhatFor: ""
WhenToUse: ""
---

# Port chess search into the corpus

## Overview

Design the port of the existing Typed chess core. The design preserves the explicit-stack search and uses perft and reference positions to qualify chess behavior. The implementation steps are in the design.

## Documents

- [Chess search corpus project](design-doc/01-chess-search-corpus-project.md)
- [Design diary](log/01-diary.md)

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.
