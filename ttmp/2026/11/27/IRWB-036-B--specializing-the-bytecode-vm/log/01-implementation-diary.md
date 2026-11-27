---
Title: Implementation diary
Ticket: IRWB-036-B
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:44:14.551445756-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## 1. Read the interpreter at r0

The requested experiment is to “specialize the bytecode VM on its bytecode, a first Futamura projection”. The repository’s IRWB-012 tests contain the two hand-written loops and an exhaustive finite input grid. The two other ticket numbers in the brief refer to incremental analysis and rewrite search in this checkout. The executable scalar/field baseline is src/typed/specialize.ts.

Ran npm run build and script 01. The first relative import climbed one directory too far and Node reported ERR_MODULE_NOT_FOUND for tools/corpus.mjs. Correcting the path produced the dispatch and frame-memory listing. This supports an IR interpreter with static control and residual word locals without any opcode table.
