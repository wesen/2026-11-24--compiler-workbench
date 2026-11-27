---
title: F37 fix report
---

# F37 fix report — range analysis under nested loops (IRWB-043-B)

## What changed

- `src/framework/dataflow/lattices.ts` — `intervalLattice` gained an optional `thresholds` parameter:
  widening up-to (Cousot/Halbwachs). A moved bound jumps to the nearest threshold instead of the extreme;
  an empty ladder is the old standard widening, so other users (the workbench's `my-analysis`) are unchanged.
- `src/typed/analyses.ts` — `typed.ranges` widens up-to `0, +-2^k (k = 0..30)`; analysis version `1` -> `2`;
  header and inline comments updated (ranges facts are now the prototype's *except* where a loop counter is
  bounded, where they are strictly more precise).
- `tests/typed/d2-defects.test.mjs` — the F37 test's `todo` removed; it passes.
- `tests/typed/guards.test.mjs` — the counter test asserted the defect itself (it required `strength` *not*
  to fire, with a comment documenting the lost bound). It now asserts the fixed behaviour: `strength` makes
  the shift and the mask, `guards` has nothing left to decide. The final-code assertions are unchanged
  (`(d >> 3)`/`(d & 7)` present; `wander`'s division stays — its `d` genuinely can go negative).

## Why this technique

The lower bound is not lost by widening alone: an inner loop head widens the outer counter's upper bound to
the i32 extreme while the outer loop is still rising; the counter's `+ 1` increment then overflows i32 in the
abstract (`evalRange` models the wraparound), producing the full interval, which flows around the outer back
edge and destroys the lower bound. Measured, a narrowing phase cannot recover it — the full interval is a
true fixpoint of the plain join iteration, because the overflowing increment re-supplies MIN through the
back edge. Widening only the bound that grows is already the implemented behaviour. Widening up-to prevents
the extreme from being reached for bounded counters, so the increment cannot overflow abstractly and the
lower bound survives; termination holds because a moved bound lands in a finite threshold set. The full
trace with evidence is in `analysis/01`, the probes in `scripts/01`–`07`.

## Acceptance (last commit)

- **F37 test**: passes without `todo`.
- **Baselines** (`02-baselines.mjs check`, after `npm run build`): originally printed one difference —
  `chess-search/speed`: census `strength` 58 -> 60 and `guards` 4 -> 2, because the more precise ranges let
  `strength` itself decide the two previously-missed `dense / 8` divisions (the inlined `chessSquare(dense)`
  in `chessPseudoMoves`, and the same shape in `chessOrder`); the image hash differs (same edits from a
  different pass), but bytes (30940) and instruction counts (278850 seed / 555142 held-out) are identical —
  no project got slower. No other typed project and no Tix program changed. Baseline re-recorded; `check`
  now prints `no differences`. `tools/parity.mjs`: 8286/8286 agree, 0 failures.
- **Suites**: tests/typed 38 files, tests/framework 23, tests/workbench 5, tests/tensor 8 (no `*-gpu`):
  all pass, 0 failures; the remaining `todo`s belong to other steps (F36, F38, the R3 tickets).
- `npm run check` clean; `node tools/build-site.mjs` builds (framework changed); Prettier clean.

## Left out

- The thresholds are a fixed ladder, not derived from the program's own comparison constants: the framework's
  `widen(previous, next, block)` has no region context, so per-function thresholds would need a framework
  contract change; the fixed ladder already fixes the defect. Listed as a later step if precision near
  non-power-of-two bounds ever matters.
- `refine`'s inconsistent-interval representation (`lo > hi` stored as `[lo, lo]`) predates this ticket and
  is untouched; it never flows into the widened bounds here, but it is not a real lattice bottom.
- `wander`-style genuinely oscillating counters still widen to the extremes, as they must (they really can
  be anywhere); only bounded counters got more precise.
