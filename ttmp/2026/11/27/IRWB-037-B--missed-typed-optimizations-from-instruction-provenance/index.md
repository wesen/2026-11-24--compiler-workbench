---
Title: Missed Typed optimizations from instruction provenance
Ticket: IRWB-037-B
Status: complete
Topics:
    - compiler
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/analyses.ts
      Note: Unsigned success edge refinement
    - Path: repo://src/typed/attribute.ts
      Note: Final dynamic cost by site
    - Path: repo://src/typed/passes.ts
      Note: Fixed array bounds elimination
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T12:59:05.564051469-05:00
WhatFor: ""
WhenToUse: ""
---

# Missed Typed optimizations from instruction provenance

## Outcome

The checked bounds pass saves 346 instructions on the historical regex fixture and 11,347 on LZ. Corpus speed saves 5,187 instructions across 50 projects. The final report records the costs of individual guards, the neutral verified rule, the fixture and corpus protocols, and the verification limits.

- [Design](design-doc/01-tracing-residual-instruction-cost.md)
- [Final report](reference/02-measured-results-and-verification.md)
- [Implementation diary](reference/01-implementation-diary.md)
- [Reproduction scripts](scripts/)
- [Measurements and verification output](various/)
