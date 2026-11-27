---
Title: 'Report: F37 range analysis under nested loops'
Ticket: IRWB-043-C
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: analysis
Intent: short-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T18:35:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Report: F37 — `typed.ranges` keeps an outer loop counter's lower bound under an inner loop

## What was wrong

`inline` puts `chessPieceMoves`' two loops inside `chessPseudoMoves`' `dense` loop. Every loop head the solver
found widened `dense`, including the inlined heads (`.n18`, `.n24`, `.n89`), which cannot assign it. Those heads
pushed the counter's upper bound to `2^31-1`; the increment `dense + 1` then overflowed i32, `evalRange`'s
`fits` fallback returned the whole range, and the negative lower bound flowed round the back edge. The body block
`.3` ended with `dense in [-2^31, 63]` instead of `[0, 63]`, so `strength` could not turn `dense / 8` into a shift.
Full event-by-event analysis: `analysis/01-why-dense-lost-its-lower-bound-and-the-widening-that-keeps-it.md`.

## The fix and why this technique

**Widen only the components the loop can change.** `widen` now widens a key only if the head's natural loop
assigns that local (`loopsOf(st, f)`'s `assigned`, memoised per region); every other key keeps the joined value.
This is the "unstable component" form of widening: a component the loop leaves alone arrives from outside and is
already stable, so widening it only destroys precision. Alternatives: *threshold widening* was implemented and
measured (`scripts/08`) — it fixes this shape but lands on a ladder rung (`[0, 66]`, not `[0, 64]`), costs 23 rounds
/ 3,266 visits against 6 / 852, and moves every loop counter's bound in the corpus; *narrowing after widening*
cannot recover, because the overflow has already destroyed the back edge's value before the descending phase
starts; *widening only the bound that grows* is already what the lattice does (both bounds move here only because
the outer head moved first). Soundness: skipping a widening keeps the join the solver passed in, which is above
every incoming fact; termination: every local assigned on a cycle through a head is in that head's `assigned` set,
and a head the loop analysis does not know (irreducible, as `rotate` can make) falls back to widening everything.

## Files

* `src/framework/dataflow/analysis.ts` — `DataflowSpec.widen` takes the region it is applied in
  (`widen(previous, next, block, region)`); `solveArtifact` passes it. The missing framework concept: a widening
  operator belongs to a lattice *and a loop*, and "what this loop can change" is not derivable from the fact or the
  block id, so an analysis could only widen everything. The per-key policy itself would belong in a
  `mapLattice`-level helper if a third analysis needs it (noted in the analysis doc, not built — no second user yet).
* `src/typed/analyses.ts` — `typed.ranges` version 2: `widen` restricted to the head's loop's assigned locals
  (`writesOfHeads`, a `WeakMap` keyed by the region).
* `tests/typed/d2-defects.test.mjs` — F37's `todo` removed, and the test now also asserts the upper bound (`≤ 63`).
* `tests/typed/guards.test.mjs` — the `counter` test asserted the defect (`strength` must not change that program).
  It now asserts that `strength` makes `dense / 8 → dense >> 3`, `dense % 8 → dense & 7`, and that `guards` still
  makes the same rewrite when it runs without `strength`; the wandering-counter case is unchanged.

## Acceptance

* **The test**: `F37: typed.ranges keeps an outer loop counter non-negative under an inner loop` — passes, no
  `todo` (`node --test --test-name-pattern=F37 tests/typed/d2-defects.test.mjs`, 40 s).
* **Baselines**: `02-baselines.mjs check` prints three differences, all in one project:
  `typed.chess-search.speed.image: "12d8744b6c5a7c04" -> "90252eb4fa3731fc"`,
  `…census.strength: 58 -> 60`, `…census.guards: 4 -> 2`. Reason: two rewrites `guards` used to make (`.38`
  `dense / 8 → dense >> 3`, `.161` `from / 16 → from >> 4`) are now made earlier by `strength`, which makes them
  now that the ranges know `dense ≥ 0`; total edits are equal (62), the instruction counts at both seeds (10 cases
  seed 7; 20 cases seed 1103) and the image size are **unchanged**, so no project is slower.
  `tools/parity.mjs`: 50 projects, 135 functions, 8300 cases, 8286 decided, 0 failures.
* **Suites**: typed 188 tests, 184 pass, 0 fail, 2 todo (F36, F38 — other steps), 2 skipped; framework 242 tests,
  238 pass, 0 fail, 4 todo; workbench 25 tests, 24 pass, 0 fail, 1 skipped (`IRWB_FULL=1`); tensor (without
  `*-gpu`) 45 tests, 44 pass, 0 fail, 1 todo.
* `npm run check` clean; `node tools/build-site.mjs` builds (50 projects, 17 chapters); prettier clean on both
  changed sources.

## Left out, and what I think is off in the brief and the tests

* **`tests/typed/guards.test.mjs` was wrong after the fix**, and the brief's "do not weaken a test's assertions"
  cannot be honoured literally: the `counter` test asserted the bug (that `strength` does *not* fire) with a
  comment naming the inner-loop widening. I replaced that assertion with the corrected one and kept the `guards`
  assertion it was guarding. If the intent was to keep the old assertion, the F37 test and this one contradict each
  other.
* **Baselines cannot be "no differences"**: any project where a more precise range changes a pass decision changes
  its image hash, because edits made at a different revision get different value ids. The acceptance's second
  sentence covers this; the first does not. chess-search is the only such project.
* The `fits` fallback in `evalRange` loses the lower bound on a wrapping add. It is the honest interval answer and
  not where the defect starts, so I left it; a wrapping-aware add is in the "Later" list.
* The header comment of `src/typed/analyses.ts` said the dataflow facts are "the prototype's"; after this change
  the ranges no longer are, so the header now names the one deliberate difference and why.
* Not touched: `src/tensor/`, `intervalLattice`, `loopsOf` (reused, unchanged), and the `frequency.ts` Tarjan SCC
  that could share a framework `cycles(graph)` helper.
