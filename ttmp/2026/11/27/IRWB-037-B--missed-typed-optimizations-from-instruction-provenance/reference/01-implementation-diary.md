---
Title: Implementation diary
Ticket: IRWB-037-B
Status: active
Topics:
    - typed
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T12:39:43.257125946-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## 1. Establish the experiment

The request was “Close the loop from hot code to new rules”. The comparison needs two workloads because the three historical numbers describe named fixtures and the D1 corpus study used generated cases. Read the five corpus ticket descriptions, fixture instructions and D1 attribution code. The design pins both protocols before the first measurement.

Node reported v24.18.0 and docmgr found the local ticket root. The first npm ci --offline failed at esbuild with spawnSync EPERM. The approved offline rerun installed the locked dependencies and npm run build succeeded. Review begins with the design and the measurement scripts.
