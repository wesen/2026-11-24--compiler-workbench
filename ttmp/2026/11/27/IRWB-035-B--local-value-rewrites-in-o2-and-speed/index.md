---
Title: Local value rewrites in O2 and speed
Ticket: IRWB-035-B
Status: complete
Topics:
    - compiler
    - ir
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Census of edit records and affected RV32 instructions across 50 Typed projects.
LastUpdated: 2026-11-27T09:43:50.277756328-05:00
WhatFor: ""
WhenToUse: ""
---

# Local value rewrites in O2 and speed

## Results

Local rewrites account for 203/2,021 O2 edits and 408/9,736 speed edits. None carries a complete verified-rule citation.

- [Design](design-doc/01-counting-local-rewrites.md)
- [Final report](analysis/01-corpus-results.md)
- [Per-pass, per-pipeline and per-project tables](analysis/02-measurement-tables.md)
- [Investigation diary](log/01-investigation-diary.md)
- [Corpus ledgers](various/census/) and [rerun scripts](scripts/)
