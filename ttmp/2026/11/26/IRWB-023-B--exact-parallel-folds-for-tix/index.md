---
Title: Exact parallel folds for Tix
Ticket: IRWB-023-B
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
Summary: Checked row fusion and exhaustively fitted binary32 exponential implementations on the GB10.
LastUpdated: 2026-11-26T18:56:04.900991324-05:00
WhatFor: ""
WhenToUse: ""
---

# Exact parallel folds for Tix

A fitted exponential and a cooperative row schedule cut 4096 × 1024 softmax from 0.745 to 0.175 ms on the GB10, with matching output words. The same region cut full attention from 1.046 to 0.757 ms. The investigation also found counterexamples to several coefficient families and a correct speculative sum that did not pay for itself.

- [Design, ranked proposals and replication commands](design-doc/01-parallel-execution-of-the-ordered-f32-fold.md)
- [Research diary, failed experiments and recovery](reference/01-investigation-diary.md)
- [Softmax timings](scripts/11-full.json) and [independent f32 digest](scripts/11-full-node.jsonl)
- [Attention timings](scripts/13-full.json) and [independent f32 digest](scripts/13-full-node.json)
- [Coefficient-fitting receipts](scripts/10-fit.json) and [v6 invariant results](scripts/09-calibrated.jsonl)

All prototypes and measurements reside in this ticket. Research was performed from product revision `12bc661`.
