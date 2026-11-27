---
Title: Investigation diary
Ticket: IRWB-035-B
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:44:38.925361903-05:00
WhatFor: ""
WhenToUse: ""
---

# Investigation diary

## 1. Establish the observation at the revision boundary

The request asks “what share of the optimizer's edits are local value rewrites?” I traced the framework report back to Tx.rewrite and the generated-word covers back to the statement. IRWB-006 supplies the rule evidence, IRWB-008 demonstrates that intermediate parents and firing names can disappear, and IRWB-010 motivates comparing dynamic work with rewrite frequency.

The first npm ci --offline --no-audit --no-fund failed in esbuild's version check with spawnSync EPERM. The approved offline retry installed the lockfile and npm run build emitted dist. Probe 01 exercised ingest, strategy publication, lowering and emulator counters on algebra. Review the design before the classifier commit.
