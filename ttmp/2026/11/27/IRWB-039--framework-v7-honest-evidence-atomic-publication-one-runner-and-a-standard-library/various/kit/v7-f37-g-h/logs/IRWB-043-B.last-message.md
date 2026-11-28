Everything is committed and the tree is clean. Final summary:

## Ticket and report
- Ticket: `ttmp/2026/11/27/IRWB-043-B--f37-typed-ranges-keeps-an-outer-loop-counter-non-negative-under-an-inner-loop/`
- Report: `.../report/01-f37-fix-report.md`; root-cause analysis: `.../analysis/01-why-dense-loses-its-lower-bound-and-the-fix.md`; diary: `.../diary/01-diary.md`; probes `scripts/01`–`07`.

## What changed
- `src/framework/dataflow/lattices.ts` — `intervalLattice` gained an optional `thresholds` parameter: **widening up-to** (Cousot/Halbwachs); a moved bound jumps to the nearest threshold instead of the i32 extreme; an empty ladder is the old standard widening.
- `src/typed/analyses.ts` — `typed.ranges` widens up-to `0, ±2^k (k ≤ 30)`; analysis version `1`→`2`; comments updated.
- `tests/typed/d2-defects.test.mjs` — F37 test's `todo` removed.
- `tests/typed/guards.test.mjs` — the counter test asserted the defect itself (`strength.changed === false`, its own comment documented the lost bound); it now asserts strength fires and guards has nothing left; final-code assertions unchanged.

## Root cause and technique
An inner loop head widens the rising outer counter's upper bound to the extreme; `dense = dense + 1` then overflows i32 in the abstract (`evalRange` models wraparound), yielding the full interval, which flows around the outer back edge and kills the lower bound. I **measured that narrowing cannot recover it** — the full interval is a true join-fixpoint (the overflowing increment re-supplies MIN), and "widen only the bound that grows" is already the implemented behaviour — so widening must avoid the extreme: thresholds. `dense` is now `[0,64]`/`[0,128]` at the heads, `[0,63]` at `bb:.3`; soundness is unchanged (C5 facts-check still verifies facts against executions; the solver still stops at a post-fixpoint).

## Acceptance
- **F37 test**: passes without `todo`.
- **Baselines**: one difference, `chess-search/speed`: census `strength` 58→60, `guards` 4→2 — the more precise ranges let strength itself decide the two previously-missed `dense / 8` divisions (inlined `chessSquare(dense)` in `chessPseudoMoves`, same shape in `chessOrder`); image hash differs, but bytes (30940) and instructions (278850 seed / 555142 held-out) are identical — nothing got slower. Baseline re-recorded; `check` prints `no differences`. `tools/parity.mjs`: **8286/8286 agree, 0 failures**.
- **Suites**: typed 38 files, framework 23, workbench 5, tensor 8 (no `*-gpu`): **0 failures**; remaining todos are other steps' (F36/F38/R3).
- `npm run check` clean; `node tools/build-site.mjs` builds (framework changed); Prettier clean.

## Notes
- The guards counter test was, in my judgment, asserting the defect; I updated it to the fixed behaviour and flagged this in the report rather than leaving it.
- Left out: program-derived thresholds (the framework's `widen` has no region context — would need a contract change; noted as a later step); `refine`'s `[lo,lo]` inconsistent-bottom representation (pre-existing, untouched).

Last commit: **dbf8b70**.
