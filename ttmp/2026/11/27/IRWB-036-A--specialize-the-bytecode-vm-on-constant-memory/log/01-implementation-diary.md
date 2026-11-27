---
Title: Implementation diary
Ticket: IRWB-036-A
Status: active
Topics: []
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:43:51.632088609-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1. Inspect the lifted VM and design the pass

Node v24.18.0 built the current worktree. The lift probe reproduced two `load16u(caddr(...), 4)` bytecode reads and two frame arrays totaling 32 bytes. Both the bytecode PC and the stack index are ordinary Typed locals, so the residualizer can use existing liveness and transactions.

The current ticket tree has the bytecode design in IRWB-012 and prior constant-memory research in IRWB-007. IRWB-009 concerns function-incremental analyses and IRWB-010 concerns rewrite search in this checkout. The scalar and field implementation is in `src/typed/specialize.ts`.

`npm ci` first failed with `spawnSync .../node_modules/esbuild/bin/esbuild EPERM`. The escalated retry installed the locked dependencies. The first lift probe resolved imports under `ttmp/tools` and failed with `ERR_MODULE_NOT_FOUND`. Correcting the relative imports to reach the worktree root made the probe pass.
