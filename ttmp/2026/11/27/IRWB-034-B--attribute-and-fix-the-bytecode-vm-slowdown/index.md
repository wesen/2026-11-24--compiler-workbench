---
Title: Attribute and fix the bytecode VM slowdown
Ticket: IRWB-034-B
Status: complete
Topics:
    - compiler
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:00:49.818610889-05:00
WhatFor: ""
WhenToUse: ""
---

# Attribute and fix the bytecode VM slowdown

The checked LICM pass created a chain of preheaders on VM dispatch backedges. The fix skips headers shared by multiple natural-loop facts. The profiler replays each revision and explains executed RV32 instructions using the existing correspondence chain.

- [Design](design-doc/01-measuring-the-cost-of-each-revision.md)
- [Final report and per-project counts](analysis/01-instruction-attribution-and-corpus-results.md)
- [Investigation diary](reference/01-investigation-diary.md)
- [Reproduction scripts](scripts/)
