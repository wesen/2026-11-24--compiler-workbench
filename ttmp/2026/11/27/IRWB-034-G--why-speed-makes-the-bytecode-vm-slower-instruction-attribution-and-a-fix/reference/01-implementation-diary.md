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

## Step 6: tests, and the tables before and after (14803c8)

- `tests/typed/attribute.test.mjs`: a two-latch loop is one loop; rows sum to the emulator's differences; a call
  that hits the limit is refused; the VM under `speed` is at or below r0 and no licm decision costs a dispatch.
- `scripts/04-attribution-tables.sh` writes the report's tables. For the "before" tables I rebuilt `dist/` with
  the old `analyses.ts`, ran the tool, and rebuilt. That flips the build under anything else running; for later
  "before" numbers `scripts/07-build-old-loops.sh` builds the old analysis into `out/old-loops/dist` and scripts
  take `IRWB_DIST`.

## Step 7: the estimate as a guard (script 05), a negative result

- On the VM with the old loops the static estimate rises at licm, as a guard would need. It also rises at the
  correct licm and at a helpful cfg step.
- Over the corpus under `speed`: 658 function steps; the estimate rises on 129, and on 65 of those the emulator
  count falls. Not usable as a per-pass gate.

## Step 8: licm variants (script 06), and a wrong first conclusion

- Variants `share` (one local per equal invariant tree) and `leaves` (do not hoist a bare frame address), as
  licm parameters, measured unchecked under `speed`. share lowers five projects and raises orders by 48 under
  the tuned options; leaves is mixed and was removed.
- `scripts/08-orders-share.mjs` shows why orders rises: `a = inv; b = inv`, and the coalescer merges only one
  of the two copies.
- First decision: keep share as an option, off, because of orders (commit 1810915).
- Then the checked corpus run for the loops fix alone finished (`various/corpus-after-loops.json`): only the VM
  and regex-nfa change, and regex-nfa under O2 with the tuned options goes from 41,695 to 45,933. The fix alone
  fails the acceptance in one cell. Script 08 on regex-nfa: with a local per hoisted use `regexMatch` has 20
  spilled values, with share 6. The correct hoisting needs share, so the decision was wrong.

## Step 9: share by default, and the coalescer

- licm shares by default (`share: false` restores a local per use).
- `backend/coalesce.ts`: a copy `rd <- rs` no longer interferes with a register that an earlier copy in the same
  block set from the same `rs`, when neither was redefined since. The argument is the one for the existing copy
  exception: at this definition both hold the same value. It applies only under the `coalesce` option, so default
  images are unchanged.
- orders under the tuned options: O2 1,020 to 1,010, `speed` 962 to 952. Test added in
  `tests/typed/speed.test.mjs` (the copies are gone and the image agrees with r0 on 200 cases).
- VM, coalesce on: Fibonacci 6,349, checksum 5,677 under O2 and `speed`.
- A mistake in the test runs: I ended a background command with `tail -9 a b c`, which this `tail` rejects, so
  the command reported failure although the logs were complete. The logs are read directly since.
