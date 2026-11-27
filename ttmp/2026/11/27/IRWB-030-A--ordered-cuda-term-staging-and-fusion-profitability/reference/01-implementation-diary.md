---
Title: Implementation diary
Ticket: IRWB-030-A
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T01:22:52.694619974-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary


## Step 1. Commit a design before changing the emitter

The Stage 3 reports show where placement changes concurrency. Stage 2 gives each row scalar its own thread, while Stage 3 puts one of those threads in each block. Expensive independent terms can run across the block while the scalar fold retains all rounding points.

The original request is the IRWB-030-A brief in this session, beginning “You are working in a git worktree of the IR Workbench repository” and ending “the last commit hash.” The design captures the supported core and bit relation, the term-buffer lifetime, the candidate timing comparison and the unchanged stage-2 path.

### Evidence

Node reports v24.18.0. The installed docmgr CLI successfully created the ticket, its design and diary, and the implementation task. The current tree already threads the benchmark flag through to the timed runner. The prior source digests give an independent test of the unchanged stage-2 path.

### Review

Start with the design and the Stage 3 mapping, then verify that any emitted barrier is reached by all participating threads and that a zero-extent reduction follows the same fold identity.
