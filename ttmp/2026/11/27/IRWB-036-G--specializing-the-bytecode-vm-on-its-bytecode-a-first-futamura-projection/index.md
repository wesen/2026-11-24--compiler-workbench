---
Title: 'Specializing the bytecode VM on its bytecode: a first Futamura projection'
Ticket: IRWB-036-G
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/bta.ts
      Note: binding-time analysis
    - Path: repo://src/typed/copyprop.ts
      Note: copyprop and copyback
    - Path: repo://src/typed/frame-slots.ts
      Note: frame-slot promotion
    - Path: repo://src/typed/program.ts
      Note: assume and specializeBuffer
    - Path: repo://src/typed/specialize-buffer.ts
      Note: specializer and pass sequence
    - Path: repo://src/typed/specialize.ts
      Note: Binding.cells and Binding.oneOf
    - Path: repo://tests/typed/specialize-buffer.test.mjs
      Note: tests
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:01:00.931663827-05:00
WhatFor: ""
WhenToUse: ""
---

# Specializing the bytecode VM on its bytecode: a first Futamura projection

## Overview

The bytecode VM of `corpus/projects/bytecode-vm/` specialized on its bytecode image by checked passes: a buffer
binding, a binding-time analysis, polyvariant block specialization with a budget, frame-slot promotion and two
copy passes. Result: 79 and 79 RV32 instructions and 96 code bytes, against 7,678 and 6,874 (840 bytes) for the
general VM and 75 and 74 (76 bytes) for the hand-written loops.

## Key Links

- Design: `design-doc/01-specializing-the-bytecode-vm-on-a-constant-buffer.md`
- Report: `analysis/01-report-the-bytecode-vm-specialized-on-its-bytecode.md`
- Diary: `reference/01-diary.md`
- Scripts and their outputs: `scripts/`

## Status

Implemented, tested and measured in one session (2026-11-27).
