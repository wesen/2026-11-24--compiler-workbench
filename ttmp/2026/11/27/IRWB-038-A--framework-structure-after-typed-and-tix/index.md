---
Title: Framework structure after Typed and Tix
Ticket: IRWB-038-A
Status: review
Topics:
    - compiler
    - ir
    - verification
    - research
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Design-level review of framework composability and checked execution after Typed, Tix, and the T6, D1, A0, and B1 comparison rounds.
LastUpdated: 2026-11-27T13:12:29.685783145-05:00
WhatFor: ""
WhenToUse: ""
---

# Framework structure after Typed and Tix

The review proposes one transformation lifecycle across Typed and Tix, with independent validation and scoped lineage. It compares the merged framework to the 31 named comparison cells and records the experiments behind each recommendation.

- [Design review and migration](design-doc/01-composable-transformations-and-independent-evidence.md)
- [Proposed compiler standard library](design-doc/01-composable-transformations-and-independent-evidence.md#the-proposed-standard-library-its-layering-criteria-and-its-primitives)
- [Cell evidence and historical records](analysis/01-cell-evidence.md)
- [Research diary](log/01-research-diary.md)
- [Tasks](tasks.md)
- [Changelog](changelog.md)

The probes run with Node 24 and `--experimental-transform-types`. The cell-specific probes require the listed sibling worktrees.
