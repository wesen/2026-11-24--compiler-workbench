Done. Ticket `IRWB-043-C` created under `ttmp/2026/11/27/`, with a diary and analysis/report docs, five commits, last one holding working code.

## Ticket and report paths
- Ticket: `ttmp/2026/11/27/IRWB-043-C--f37-range-analysis-under-nested-loops/`
- Report: `…/analysis/02-report-f37-range-analysis-under-nested-loops.md`
- Analysis (event-by-event cause, alternatives, framework note): `…/analysis/01-why-dense-lost-its-lower-bound-and-the-widening-that-keeps-it.md`
- Diary: `…/reference/01-diary.md`; probes: `…/scripts/01`–`08`

## What changed, file by file
- `src/typed/analyses.ts` — `typed.ranges` v2: `widen` now widens only the keys that are locals of the head's natural loop `assigned` set (`loopsOf`, memoised per region); other keys keep the join. Header names this as the one deliberate difference from the prototype.
- `src/framework/dataflow/analysis.ts` — `DataflowSpec.widen` gets the region: `widen(previous, next, block, region)`; `solveArtifact` passes it. (Missing framework concept: a widening operator belongs to a lattice *and a loop*, "what this loop can change" isn't derivable from the fact or block id.)
- `tests/typed/d2-defects.test.mjs` — F37 `todo` removed; also asserts the upper bound (≤ 63).
- `tests/typed/guards.test.mjs` — the `counter` test asserted the *defect* (`strength` must not fire, comment named the inner-loop widening); now asserts `strength` makes `dense/8 → dense>>3`, `dense%8 → dense&7`, and `guards` still makes it without `strength`.
- Docs/scripts under the ticket.

Cause: `inline` puts `chessPieceMoves`' loops inside the `dense` loop; its heads widen `dense`, which they never assign (0→63 becomes 0→2³¹−1), then `dense + 1` overflows and `evalRange`'s `fits` fallback returns the full range, taking the lower bound with it. Technique chosen: widen only the components the loop can change. Measured alternative: threshold widening fixes the shape but lands on `[0, 66]`, costs 23 rounds/3266 visits vs 6/852, and moves every loop counter's bound in the corpus; narrowing after widening cannot recover because the overflow has already destroyed the back edge.

## Acceptance
- **Test**: `F37: typed.ranges keeps an outer loop counter non-negative under an inner loop` ✔ (27–40 s, no `todo`).
- **Baselines** (`02-baselines.mjs check`, final code): three lines, one project —
  `typed.chess-search.speed.image: "12d8744b6c5a7c04" -> "90252eb4fa3731fc"`, `…census.strength: 58 -> 60`, `…census.guards: 4 -> 2`. Reason: two rewrites `guards` made (`.38` `dense/8 → dense>>3`, `.161` `from/16 → from>>4`) now happen earlier, in `strength`; total edits equal (62), RV32 instruction counts at both seeds (10/seed 7, 20/seed 1103) and image size unchanged → nothing slower. So it does not print `no differences`; that conflicts with the first acceptance sentence (see below). `tools/parity.mjs`: 50 projects, 135 functions, 8300 cases, 0 failures.
- **Suites**: typed 188 tests / 184 pass / 0 fail / 2 todo (F36, F38) / 2 skipped; framework 242 / 238 / 0 / 4 todo; workbench 25 / 24 / 0 / 1 skipped (`IRWB_FULL=1`); tensor (no `*-gpu`) 45 / 44 / 0 / 1 todo.
- `npm run check` clean; `node tools/build-site.mjs` builds; prettier clean on both changed sources.

## Left out / believe wrong
- `tests/typed/guards.test.mjs` was *wrong after the fix*: it asserted the bug, so "don't weaken assertions" could not hold literally — F37 and that test contradict each other. I replaced that one assertion with the corrected one and kept the `guards` assertion it existed for.
- Baselines can never be literally "no differences" when precision changes a pass decision, because a rewrite made at a different revision gets different value ids and hence a different image hash; the brief's second sentence allows this, the first does not.
- `evalRange`'s `fits` fallback (wrapping i32 add → full range) is the honest interval answer and not where the defect starts; a wrapping-aware add is in the "Later" list, with a `mapLattice`-level "widen these keys" helper and a framework `cycles(graph)` helper (second use: `src/typed/backend/frequency.ts`'s private Tarjan).

Last commit: **bac47f3**
