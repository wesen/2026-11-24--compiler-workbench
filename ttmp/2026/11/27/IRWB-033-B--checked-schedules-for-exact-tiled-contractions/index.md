---
Title: Checked schedules for exact tiled contractions
Ticket: IRWB-033-B
Status: complete
Topics:
    - tensor
    - gpu
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Checked Tix schedule revisions and exact tiled contractions on GB10
LastUpdated: 2026-11-27T11:14:31.257037896-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked schedules for exact tiled contractions

The compiler lowers through a schedule artifact with named folds, v6 layout passes, and a shape-dependent launch policy. The report compares exact f32 execution and interleaved GB10 timing with base revision 0f45d04.

- [Design committed before implementation](design-doc/01-scheduling-exact-contractions.md)
- [Measurements and framework findings](reference/02-results.md)
- [Implementation diary](reference/01-implementation-diary.md)
- [Replay scripts and raw results](scripts/)
- [Tasks](tasks.md) and [changelog](changelog.md)
