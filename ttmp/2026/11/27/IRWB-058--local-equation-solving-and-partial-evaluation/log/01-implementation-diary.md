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

## 2. Measure the partial-evaluation restatement

Committed the passing experiment as `77e1bed`. The generic division propagated dynamic operands through a congruence predicate on `solveFor`. The generic unfold interned live static stores before scheduling them. Its unit fixtures covered refusal, reuse of an existing generalized variant, and an external fallback target. Typed still supplied the static kinds, evaluation, residual statement logic, and transaction edits.

The first prototype build found two stale `kindOf` call sites passing the static map where the new signature expected a lookup function. After updating both, `npm run build` and the experiment test run passed 11/11, including seven existing B1 tests. The B1 measured counts remained 110 and 122.

The restatement measured 279 + 373 = 652 lines after formatting, against 279 + 369 = 648 originally. Applied the gate and restored the original B1 files. The experiment and its tests are accessible in the branch history.

## 3. Verify the retained change

Declared SCCP's existing framework SSA analysis as a pass dependency and added a regression where a loop backedge makes a condition vary, enabling a new edge. The final TypeScript build, type check and standalone site build passed. Git writes required escalation because the sandbox mounted the worktree index read-only.

Ran the requested suites by file with Node's test runner in tmux. The 565 executed tests passed, with three pre-existing opt-in Candela skips. The coordinator's default baseline comparison printed `no differences`.
