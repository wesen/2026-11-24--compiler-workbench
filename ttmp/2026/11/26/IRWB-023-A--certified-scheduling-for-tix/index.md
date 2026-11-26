---
Title: Certified scheduling for Tix
Ticket: IRWB-023-A
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
Summary: IRWB-023-A research into exact GPU schedules with proof and performance evidence.
LastUpdated: 2026-11-26T18:47:46.865912837-05:00
WhatFor: ""
WhenToUse: ""
---

# Certified scheduling for Tix

This ticket studies the performance of checked, ordered-f32 schedules on the GB10. The leading proposals are row-resident execution, revision-bound schedule checking, and ordered contraction tiling with conditional integer specialization.

- [Research design and results](design-doc/01-certified-scheduling-for-tix.md)
- [Research diary](reference/01-research-diary.md)
- [Prototypes and raw evidence](scripts/)
- [Tasks](tasks.md)
- [Changelog](changelog.md)
