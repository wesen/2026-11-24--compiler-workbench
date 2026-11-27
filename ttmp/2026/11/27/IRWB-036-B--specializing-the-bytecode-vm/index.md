---
Title: Specializing the bytecode VM
Ticket: IRWB-036-B
Status: complete
Topics:
    - compiler
    - ir
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/residualize.ts
      Note: Binding-time analysis and block versioning
    - Path: repo://src/typed/specialize.ts
      Note: Host bindings and checked pass
    - Path: repo://src/typed/split-ranges.ts
      Note: Local lifetime splitting for residual cleanup
ExternalSources: []
Summary: Checked specialization of the Typed VM yields two 48-byte RV32 images.
LastUpdated: 2026-11-27T10:18:37.643862749-05:00
WhatFor: ""
WhenToUse: ""
---

# Specializing the bytecode VM

## Result

A fixed u16 bytecode image and a fixed entry are enough to compile the interpreter to a scalar loop. Fibonacci and checksum each execute 77 RV32 instructions at n=12 and seed=8. Each generated function still accepts the original VM arguments.

- [Design and supported domain](design-doc/01-binding-time-and-residual-control-flow.md)
- [Measurements, checks and limits](analysis/01-measurement-report.md)
- [Implementation diary](log/01-implementation-diary.md)
- [Benchmark](scripts/02-measure.mjs) and [RV32 listings](various/04-split-results.txt)
