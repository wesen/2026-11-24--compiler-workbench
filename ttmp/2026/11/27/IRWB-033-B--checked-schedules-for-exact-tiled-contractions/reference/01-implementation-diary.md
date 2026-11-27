---
Title: Implementation diary
Ticket: IRWB-033-B
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
LastUpdated: 2026-11-27T10:04:09.014532792-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary


## Step 1. Design checkpoint

The request is “Build a schedule IR, and make it the compiler.” The primary acceptance path is the public synchronous source function and the asynchronous GPU contract consuming the same schedule. I read stages 3b, 3 and 2, the contract and adapter APIs and the named paper. Node reports v24.18.0. The worktree initially had no dependencies. npm ci --offline installed the six locked packages from cache.

The base imports its plan in two places. Consolidating these paths prevents a checker from validating a different compiler than the public API. The stage 3b gate already forces both branches on tiny differential samples. Review the template specialization and the ordered tail when comparing the new paths.
