---
title: Diary
---

# Diary

## Step 1 — reproduce and locate the loss

- Ran IRWB-037-G's probe 14: `dense` is `[-2^31, 63]` at `bb:chessPseudoMoves.3` before `strength`, and even
  the outer head `bb:.1` is already full. So the loss is not a body-local refinement gap.
- Script `01-trace-widen.mjs`: wrapped `typed.ranges`' widen on chessPseudoMoves. Widening #5 at the outer
  head joins `[-2^31, 2147483647]` — MIN arrives through the *back edge*, after widens #1–#4 at the outer and
  the three inner heads produced `[0, MAX]`.
- Script `02-trace-first-negative.mjs` / `03-trace-tail.mjs`: MIN is born in the loop tail `bb:.13`, visit
  565: `dense` in `[0, MAX]`, the statement `dense = dense + 1` out `[-2^31, MAX]`. `evalRange` models i32
  wraparound (`fits` returns full when a bound leaves i32), so `MAX + 1` collapses to the full interval.
- Script `04-widen-preds.mjs`: the inner heads widen `dense`'s hi 63 -> MAX (their previous value was `[0,2]`,
  still rising), and nothing inside the inlined body refines `dense` again; `[0, MAX]` reaches the tail.
  Failure: widening to the extreme + wraparound-aware increment => the counter's lower bound dies, and the
  full interval is stable.

## Step 2 — choose the technique (measurement, not taste)

- Checked whether a narrowing phase could recover: with the widened state as the start, a plain join sweep
  changes nothing (probe 04, sweep ~2 shows the head's join already full). The overflowing increment
  re-supplies MIN through the back edge, so the full interval is a true join-fixpoint — narrowing cannot
  undo it. This rules out the "narrowing after widening" option.
- "Widen only the bound that grows" is already the implemented behaviour; it does not address the failure.
- Chose widening up-to (thresholds), added domain-independently to the framework's `intervalLattice`
  (`thresholds` parameter; empty ladder = old behaviour). Ladder `0, +-2^k (k<=30)`: the corpus's loop
  bounds are powers of two; overshoot < 2x; the loop condition's branch refinement re-tightens the body.
- After the fix (probe 01 re-run): `dense` is `[0,128]` at the outer head, `[0,64]` at the inner heads,
  `[0,63]` at `bb:.3`. Rounds 31 vs 8 (the threshold climb), still far under `maxRounds` 200.

## Step 3 — consumers and behaviour change

- `strength` now fires on the two previously-missed `dense / 8` divisions (probe `06`/`07`): the inlined
  `chessSquare(dense)` in `chessPseudoMoves` and the same shape in `chessOrder`.
- `tests/typed/guards.test.mjs`'s counter test asserted the defect itself (`strength.changed === false`,
  with a comment saying ranges loses the bound). Updated it to assert the fixed behaviour: strength makes
  the shift/mask, guards has nothing left, and the final-code assertions are unchanged (shift+mask present,
  `wander`'s division stays — its `d` really can go negative, soundly kept).
- The one guards rule that used to do this job is still exercised by the other guards tests.

## Step 4 — acceptance

- F37 test un-todo'd, passes. All suites pass (0 failures; the remaining todos are other steps').
- Baselines: only `chess-search/speed` differs — census `strength` 58->60, `guards` 4->2 (the same two
  divisions, now decided by strength); image hash differs (edit order), but bytes (30940) and instruction
  counts (278850 seed / 555142 held-out) are identical, so nothing got slower. Re-recorded the baseline;
  `check` now prints `no differences`.
- `tools/parity.mjs`: 8286/8286 agree, 0 failures. `npm run check` clean; `tools/build-site.mjs` builds
  (framework changed); Prettier clean on the changed files.
