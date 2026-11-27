---
Title: Attribute and fix the Typed bytecode VM speed regression
Ticket: IRWB-034-A
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
Summary: Measured Typed LICM regression, compiler fix, and reusable RV32 instruction attribution.
LastUpdated: 2026-11-27T10:19:50.309523767-05:00
WhatFor: ""
WhenToUse: ""
---

# Attribute and fix the Typed bytecode VM speed regression

## Result

Typed LICM was treating sibling back edges of a single dispatch loop
as external edges. Grouping them by header restores one preheader and
keeps the address calculations off the dispatch path. The new
attribution API connects executed RV32 words to Typed optimization
edits across revisions.

- [Design](design-doc/01-attribute-dynamic-rv32-cost-to-typed-optimization-decisions.md)
- [Final report](analysis/01-bytecode-vm-speed-attribution-and-validation.md)
- [Implementation diary](log/01-implementation-diary.md)
- [Reproduction scripts and measurements](scripts/)
- [Tasks](tasks.md)
- [Changelog](changelog.md)
