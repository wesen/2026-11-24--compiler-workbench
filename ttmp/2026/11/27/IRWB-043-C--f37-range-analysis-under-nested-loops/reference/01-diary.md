---
Title: 'Diary'
Ticket: IRWB-043-C
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: short-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T18:25:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1 — the shape, reproduced (17:30)

Ticket created (`docmgr ticket create`), `npm run build`, and `scripts/01-probe-nested-ranges.mjs`, a copy of
IRWB-037-G's `14-probe-chess-shapes.mjs` extended to print every block's fact for `dense` and the loop heads.
Reproduced `bb:chessPseudoMoves.3 dense in [-2147483648, 63]`; the pass list before `strength` is
`inline inline cfg thread fold simplify constprop copies fold simplify dce cfg licm lvn`, so `inline` has put
`chessPieceMoves`' two loops inside the `dense` loop. Also found that `f.blocks` does not carry `preds`, so the CFG
comes from `cfgOf`/`flowGraph` (`scripts/03`, `04`).

## Step 2 — which head widens it (17:40)

`scripts/02-log-widenings.mjs` monkeypatches `rangesAnalysis.spec.widen` (the spec object is what `solveArtifact`
closes over, so patching it works) and logs every widening that moves `dense`. Four loop heads: `.1` (outer), `.n18`,
`.n24`, `.n89` (inlined). Each widens `dense` to `[0, 2^31-1]`, then a second round of widening at `.1` turns it into
the full range. `scripts/05-first-negative-lower.mjs` orders transfer/widen/edge events and finds the first negative
bound: `.13` (`dense = dense + 1`) with input `[0, 2^31-1]` produces the full range (the i32 overflow fallback in
`evalRange`), and that negative lower bound then flows round `.1`.

## Step 3 — the fix (18:00)

Diagnosis: an inner loop head widens a local it never assigns. Chosen technique: widen only the components the loop
can change — the locals of the head's natural loop's `assigned` set, which `typed.loops` (`loopsOf`) already
computes. This needs the region inside `widen`, so `src/framework/dataflow/analysis.ts` now passes it:
`widen(previous, next, block, region)`.

Alternatives weighed: thresholds (measured in step 5), a narrowing phase (the overflow has already destroyed the
back edge, so it cannot recover), "widen only the bound that grows" (already what the lattice does, and both bounds
move).

`npm run build`, then `node --test --test-name-pattern=F37 tests/typed/d2-defects.test.mjs`: passes in 40 s with the
`todo` removed. Facts now: `.1 in [0, 2147483647]`, `.3 in [0, 63]`, `.13 in [0,63] out [1,64]`.

## Step 4 — the test that encoded the defect (18:10)

`tests/typed/guards.test.mjs`'s `counter` test asserted `strength` must **not** change a nested-loop counter, with a
comment naming exactly this bug ("typed.ranges loses d's lower bound here: the inner loop's head widens d while the
outer loop is still rising"). It fails now. Rewrote it to assert the corrected facts: `strength` alone makes
`(s + (d >> 3)) + (d & 7)` out of `d / 8 + d % 8`; `guards` still makes the same rewrite when it runs without
`strength`; the `wander` bound (a counter that goes down) still keeps its division. Nothing was dropped except the
assertion that stated the defect.

## Step 5 — evidence (18:20)

* `scripts/06-time-cost.mjs`: the shape costs 45 s because every pass's meaning check runs three times; the ranges
  fact of `chessPseudoMoves` is 6 rounds, 852 visits (2.9 s), so the fix is not a dataflow cost.
* `scripts/07-diff-speed-edits.mjs`: runs `speed` on chess-search with the old widening (every key) and the new one,
  and prints the census and the edits. Old: `strength 58, guards 4`. New: `strength 60, guards 2`; the two rewrites
  that moved are `dense / 8 → dense >> 3` in `.38` and `from / 16 → from >> 4` in `.161`, now made by `strength`.
* `scripts/08-threshold-widening-alternative.mjs`: threshold widening gives `dense in [0, 66]` at `.1` and
  `[0, 63]` at `.3`, the same census, but 23 rounds / 3,266 visits against 6 / 852, and it moves every loop
  counter's bound in the corpus.
* `02-baselines.mjs check`: one project differs (chess-search under `speed`: image hash, the census move above);
  instruction counts at both seeds unchanged.
* Suites: typed 188 tests / 184 pass / 0 fail / 2 todo (F36, F38) / 2 skipped; framework 242 / 238 / 0 / 4 todo;
  workbench 25 / 24 / 0 / 1 skipped; tensor 45 / 44 / 0 / 1 todo. `tools/parity.mjs`: 50 projects, 135 functions,
  8300 cases, 0 failures. `npm run check` clean, `node tools/build-site.mjs` builds, and prettier is clean on both changed sources.
