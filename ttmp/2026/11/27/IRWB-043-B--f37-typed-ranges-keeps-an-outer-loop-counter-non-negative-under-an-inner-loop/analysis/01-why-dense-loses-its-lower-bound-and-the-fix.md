---
title: Why dense loses its lower bound, and the fix
---

# Why `dense` loses its lower bound (F37), and the fix

## The defect, traced

`chessPseudoMoves` (chess-search) counts `dense` 0..63 in an outer loop. Under `speed` before `strength`,
`chessPieceMoves` is inlined into that outer loop, so the function has four loop heads: the outer
`bb:chessPseudoMoves.1` and three inner heads (`n18`, `n24`, `n89`). Probes `01`–`04` (scripts/) trace
`typed.ranges`' widening on this function; the chain is:

1. After three visits the heads widen. At the inner heads, `dense`'s joined value is `[0,63]` (branch-refined
   by the outer `dense < 64`) but the previous value is still `[0,2]`, so the standard widening jumps the
   upper bound to the i32 extreme: `[0, 2^31-1]` (probe 01, widens #2–#4).
2. No condition inside the inlined body mentions `dense`, so the inflated interval flows unrefined to the
   loop tail `bb:chessPseudoMoves.13` (probe 04, sweep ~1: `pred n23 out [0, 2147483647]`).
3. The tail's `dense = dense + 1` is evaluated by `evalRange`, which models i32 wraparound (`fits` returns
   the full interval when a result bound leaves i32): `hi = MAX + 1` overflows, so the statement's result is
   the full interval `[MIN, MAX]` (probe 03, visit 565: in `[0, MAX]` -> out `[-2^31, MAX]`).
4. That full interval joins into the outer head; widening keeps `lo = MIN` (probe 01, widen #5), and every
   head stabilizes at the full interval. `dense` arrives at `bb:chessPseudoMoves.3` as `[-2^31, 63]`, so
   `strength` cannot prove `dense / 8` non-negative.

The lower bound is thus not lost by widening directly — it is destroyed by the abstract i32 overflow of the
increment, which widening *enables* by pushing the upper bound to the extreme.

## The technique: widening up-to (thresholds), in the framework's interval lattice

Three standard candidates from the brief:

- **Widen only the bound that grows** — already the behaviour: each bound is widened independently. It does
  not help, because the bound that moves (`hi`) is exactly what poisons the increment.
- **A narrowing phase after widening** — measured, cannot recover (probe 04, sweep ~2: the join at the outer
  head is already `[-2^31, 2147483647]`). The full interval is a *fixpoint* of the plain join iteration: the
  overflowing `dense + 1` re-supplies `MIN` through the back edge, so join- or narrowing-sweeps started from
  the widened state change nothing. The imprecision must be prevented at widening time.
- **Widening with thresholds** (Cousot/Halbwachs *widening up-to*) — chosen. A moved bound jumps to the
  nearest threshold instead of the extreme. `dense`'s upper bound stops at 64 at the inner heads and 128 at
  the outer head; the increment stays inside i32; the lower bound 0 survives; the branch refinement at the
  loop condition re-tightens the body to `[0,63]`.

Termination: a moved bound always lands in the finite threshold set, or at an extreme once it is past all of
them, so widening sequences stay finite. Soundness is unchanged: the solver still stops only when a sweep
changes nothing, i.e. at a post-fixpoint, and the facts-check tests (IRWB-005 C5) still verify the facts
against executions.

The ladder is `0` and `+-2^k` for k = 0..30, chosen for this corpus: its loop bounds are powers of two
(board sizes 8/16/64/128, buffers 512, frames 4096, 16-bit units), a threshold overshoots the observed
growth by under 2x, and `2^30` is the last power below `2^31-1`, so a bound past the ladder still reaches the
extreme in one step. A genuinely unbounded counter (compared against a parameter) still climbs to the
extreme — soundly, over about 31 sweeps instead of 4 (compile-time only; `maxRounds` is 200; the corpus
still solves every function).

## Where it lives

- `src/framework/dataflow/lattices.ts`: `intervalLattice(min, max, thresholds = [])` — the domain-independent
  concept; an empty ladder is the old standard widening, so the workbench's own `my-analysis` is unchanged.
- `src/typed/analyses.ts`: `typed.ranges` passes the ladder; version `1` -> `2` (its facts changed).
