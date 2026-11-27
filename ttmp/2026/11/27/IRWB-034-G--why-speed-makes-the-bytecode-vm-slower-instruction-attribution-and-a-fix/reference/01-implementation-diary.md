---
Title: Implementation diary
Ticket: IRWB-034-G
Status: active
Topics:
    - typed
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Diary of IRWB-034-G
LastUpdated: 2026-11-27T10:07:23.282944277-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1: set up, and locate the regression by pass

- Read the contracts and IR READMEs, `define-pass.ts`, `strategies.ts`, `passes.ts`, the IRWB-012 notes and
  test. The worktree had no `node_modules` or `dist`: `npm ci`, `npm run build`.
- `scripts/01-per-pass-steps.mjs` applies `speed` (and O2) pass by pass to the VM and runs both fixtures after
  each. Result: every pass up to the second cfg lowers the count (7,678 to 6,688 for Fibonacci); licm raises it to
  9,287; nothing after it matters. O2 has the same step, so the regression is not specific to `speed`.
- `scripts/02-licm-listing.mjs` prints the IR on both sides of licm. licm made nine preheaders (`n0` to `n8`),
  chained, and all back edges of the dispatch loop go through them; fifteen `inv = frame+0` statements sit in
  them. `typed.loops` returned nine loops for the one header, one per back edge.
- The machine is shared (load average above 40 on 8 cores), so each pipeline run with checks takes tens of
  seconds. The first run of script 01 for two pipelines exceeded the 120 s tool limit and finished in the
  background.

## Step 2: the baseline for the corpus

- `scripts/03-corpus-measure.mjs`: r0, O2 and `speed` per project, instructions summed over the 10 seeded cases
  per function that `measure` uses, under the default backend options and under chains + coalesce + homes. Passes
  are checked with 5 cases to keep the run short; `tools/parity.mjs` does the full check.
- Started in the background before any source change, into `various/corpus-before.json`. Its modules were loaded
  at start, so later rebuilds of `dist/` do not change what it measures (the only lazy import in `src/typed` is
  `specialize`, which the run does not use).

## Step 3: design, committed (85889a1)

- Attribution per pass step with exact sums, sites are statements, decisions from edit records. Fix in
  `typed.loops` (one loop per header), with the licm-only guard as the fallback.
- I had written a time for the attribution run into the design before measuring it; removed before the commit.

## Step 4: the attribution (`src/typed/attribute.ts`, `tools/attribute.mjs`)

- `attributeSteps(revisions, call, { backend })` lowers and runs every revision, sums counts per statement
  (`covers`), joins statements across a step, and labels each group from the pass's edits.
- First run on the VM at the baseline compiler: licm's step is +2,599, of which +2,748 is
  `licm: insert (hoisted out of loop:runVm@bb:runVm.3)` in 15 groups (each hoisted statement runs once per
  dispatch), +184 the preheader jump, and -328 the uses that no longer compute `frame+0`. The rows of each step
  sum to the emulator's difference.

## Step 5: the fix

- `loopsOf` groups back edges by header and returns one loop with the union body, `latches`, and the preheader
  against the union; `typed.loops` is version 2.
- VM under `speed`, coalesce on: Fibonacci 6,382, checksum 5,710. licm's step is now -306: the fifteen hoisted
  statements cost 15 instructions in total.
