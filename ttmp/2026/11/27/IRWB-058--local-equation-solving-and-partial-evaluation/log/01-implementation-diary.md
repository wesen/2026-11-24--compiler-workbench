---
Title: Implementation diary
Ticket: IRWB-058
Status: active
Topics: []
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T23:46:58.354735238-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## 1. Demand-driven SCCP

Read the R3 solver interface and partial-evaluation decision, the phase 4 plan, and the library layering. Measured the specified files before changing B1: 279 lines in `specialize.ts` and 369 in `pe.ts`. The requested half-size gate is 324 lines.

SCCP uses equations for SSA names, executable blocks and explicit edges. It starts at the entry, follows enabled successors, and reads incoming edge facts for phis. The solver owns discovery, dependency tracking and scheduling. An exhausted solve returns partial facts, while SCCP runs unbounded over its finite-height system.

`npm ci` failed with `spawnSync .../node_modules/esbuild/bin/esbuild EPERM`. The escalated installation succeeded. Node 24.18.0, the TypeScript build and the test runner with `--test-isolation=none` worked in this checkout. The two solver tests and six existing SSA tests passed. The B1 probe measured 110 and 122 instructions for entries 0 and 34 under `promote+speed`.
