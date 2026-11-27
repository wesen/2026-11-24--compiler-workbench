---
Title: Implementation diary
Ticket: IRWB-037-A
Status: active
Topics:
    - compiler
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T12:39:52.981423696-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1 — Establish the baseline and commit the design

I read the D1 attribution report and the corpus tickets for the existing fixture protocols. I kept those fixtures for the headline numbers and added a separate entry-scoped corpus comparison to keep the per-project rows comparable with the reference.

### What worked

- `npm run build` succeeded with Node v24.18.0.
- The baseline runner in `scripts/01-measure.mjs` reproduced the reference regex and LZ figures. The provenance baseline begins at `2966b9b`.

### What did not work

- The sandbox returned `error connecting to /tmp/tmux-1000/default (Operation not permitted)` for the tmux probe. Escalated execution with the private `irwb037a` tmux socket started the benchmarks.

### Review

Read the design and `scripts/01-measure.mjs` together. The benchmark caps come from the existing corpus and chess fixture protocols.
