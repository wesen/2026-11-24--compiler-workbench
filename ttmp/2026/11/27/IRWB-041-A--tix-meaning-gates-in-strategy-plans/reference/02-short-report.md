---
Title: Short report
Ticket: IRWB-041-A
Status: active
Topics:
    - tensor
    - framework
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T17:27:41.720097202-05:00
WhatFor: ""
WhenToUse: ""
---

# Short report

Tix passes now carry their meaning relation: inline is exact and split-sum uses tolerance. `optimizeTix` reads that declaration. `tixAlgorithm` supplies a transformation contract and origin input to the existing strategy bridge, with the gate as an invariant. Evidence is normalized by a JSON round trip as in the R3 probe, because the analysis manager rejects undefined fields.

The simplest alternative, choosing the relation by pass name, would repeat the original coupling and would not work for a renamed or derived pass. The synchronous optimization path remains in place; a synchronous strategy driver is later work.

The F27 regression and TypeScript check passed. The corpus baseline comparison reported `no differences`. The non-GPU suite run reported 66 passing and 4 failing files out of 70 in the sandbox. All four failing files passed on an escalated rerun: 15 tests passed, 1 skipped, 0 failed. The file-level reporter did not expose the original individual failures, so their precise causes are unconfirmed. No framework files changed. GPU tests were excluded as requested.

The test file's introductory comment says `optimizeTix` should run a plan; the task explicitly keeps it synchronous, so that comment is stale. No assertions were weakened.
