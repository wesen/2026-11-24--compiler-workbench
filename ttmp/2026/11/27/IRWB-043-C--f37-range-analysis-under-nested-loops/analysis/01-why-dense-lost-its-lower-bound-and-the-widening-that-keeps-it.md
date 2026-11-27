---
Title: 'Why dense lost its lower bound, and the widening that keeps it'
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
LastUpdated: 2026-11-27T18:20:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# F37: range analysis under nested loops

Ticket: `ttmp/2026/11/27/IRWB-043-C--f37-range-analysis-under-nested-loops/` (step IRWB-043-C of IRWB-039).
Scope: `src/typed/analyses.ts` (`typed.ranges`) and one framework hook, `src/framework/dataflow/analysis.ts`.

## The symptom

`typed.ranges` on `chess-search`'s `chessPseudoMoves`, after the passes `speed` runs before `strength`
(`inline inline cfg thread fold simplify constprop copies fold simplify dce cfg licm lvn`):

```
bb:chessPseudoMoves.1   dense in [-2147483648, 2147483647]    (the `for (dense = 0; dense < 64; …)` head)
bb:chessPseudoMoves.2   dense in [64, 2147483647]             (the loop's exit)
bb:chessPseudoMoves.3   dense in [-2147483648, 63]            (the body, where `dense / 8` is)
bb:chessPseudoMoves.13  dense in [0, 63] out [1, 64]          (the increment)          [after the fix]
```

`dense` counts 0 to 63, so `dense / 8` could be `dense >> 3` and `dense % 8` a mask, but the fact strength sees in
`.3` was `[-2^31, 63]`: the upper bound from the loop guard refinement, the lower bound gone.

## What happens, event by event

`inline` puts `chessPieceMoves` (which has a `for i` loop and a `while` loop) inside the `dense` loop, so
`chessPseudoMoves` has four loop heads: `.1` (the `dense` loop), `.n18` (the inlined `for i`), `.n24` (the inlined
`while (chessOnBoard(to))`) and `.n89` (the inlined `while (to <= next + 1)`). The solver widens at all four after
three visits (`widenAfter: 3`, round-robin). Logging every widening of `dense` (script `02-log-widenings.mjs`):

```
widen at .1:   dense [0,2] -> joined [0,3]   => [0, 2147483647]    the counter really does grow: standard widening
widen at .n18: dense [0,2] -> joined [0,63]  => [0, 2147483647]    an inner head widens a local it never assigns
widen at .n24: dense [0,2] -> joined [0,max] => [0, 2147483647]
widen at .n89: dense [0,2] -> joined [0,63]  => [0, 2147483647]
widen at .1:   dense [0,max] -> joined [-2147483648, 2147483647] => [-2147483648, 2147483647]
```

Two links lose the bound, and the second is what turns a lost *upper* bound into a lost *lower* one:

1. **An inner loop head widens a local it cannot change.** `dense` is not assigned by the inlined `for i` or either
   `while`, yet their heads widen it. At `.n18` the joined value `[0, 63]` (the guard refinement of the outer loop)
   is above the previous `[0, 2]` (the outer loop head was still rising), so standard widening jumps the upper bound
   to `2^31-1`. This is not a bug in the lattice: widening a component that the loop leaves alone is simply
   pointless — the value arrives from outside the loop, so it is already stable, and all the widening does is throw
   the fact away.
2. **The increment then overflows.** The inner heads' widened `[0, 2^31-1]` reaches the increment block `.13`
   (`dense = dense + 1`); `evalRange` computes `[1, 2^31]`, which does not fit in i32, and `fits` returns the whole
   range. `[-2^31, 2^31-1]` flows round the back edge into `.1`, whose join (and widening) now has a negative lower
   bound, and every refinement after it can only cap the upper end: `.3` gets `[-2^31, 63]`.

Script `05-first-negative-lower.mjs` pins the first event with a negative bound:

```
#570 T .n7 in [0, 2147483647] out [0, 2147483647]     the inner loops' widened fact leaves the body
#571 T .13 in [0, 2147483647] out [-2147483648, 2147483647]   dense + 1 overflows: full range
#578 W .1  old [0, 2147483647] joined [-2147483648, 2147483647] => [-2147483648, 2147483647]
```

The `fits` fallback is the honest answer for a *wrapping* i32 add of `[0, 2^31-1]` — the true result of `dense + 1`
can be any value — so the arithmetic is not where this should be fixed. The loss starts with the inner head.

## The technique: widen only the components the loop can change

Widening is per component of the fact and only needed for the components that *grow around the back edge*; this is
the "unstable component" reading of widening, the parts of the fact a loop can change. `typed.loops` already
computes exactly that set per header: `loopsOf(st, f)` gives each natural loop's `body` and `assigned` locals
(IRWB-034-G). `typed.ranges`' transfer only writes the local of a `set` statement, so a local outside a loop's
`assigned` set arrives from outside the loop unchanged and only has to be joined.

The fix, in `src/typed/analyses.ts`:

```ts
widen(a, b, block, region) {
  const m = new Map(b);
  const writes = writesOfHeads(region).get(block);   // the head's natural loop's assigned locals, memoised
  for (const [k, v] of b)
    if (a.has(k) && (!writes || writes.has(Number(k)))) m.set(k, interval.widen(a.get(k)!, v));
  return m;                                          // a local the loop leaves alone keeps the join
}
```

*Soundness*: widening only ever enlarges a fact, so replacing it with the joined value `b` (which is what the
solver passed in) is still above every incoming fact; no bound is invented and no refinement depends on the
omitted widening.
*Termination*: every local assigned anywhere on a cycle through the head is in that head's natural loop `assigned`
set, so every component that can move around the back edge is still widened; components like `dense` at `.n18` are
joints of values from outside that head, whose sources are themselves widened at the heads above them. A head the
loop analysis does not know — an irreducible loop, which `rotate` can make (src/typed/rotate.ts) — is widened as
before (`!writes`), so no loop loses its widening. Measured: 6 rounds and 852 block visits for
`chessPseudoMoves`, and no dataflow error in any test or in the corpus.

Result: `dense` is `[0, 63]` in `.3` and `.7`, `[0, 2^31-1]` at the outer head `.1` (where it is the loop's own
counter and grows), `[1, 64]` in the increment. `strength` now rewrites `dense / 8` to `dense >> 3`, and `dense % 8`
to `dense & 7` (`06`, `07`).

## The alternatives, and why not

* **Widening with thresholds** (a growing bound jumps to the next threshold taken from the function's constants
  instead of the domain's extreme). Measured with `08-threshold-widening-alternative.mjs`, which monkeypatches the
  same operator with a threshold set of every i32 constant the function mentions: `dense` is `[0, 66]` at `.1` and
  `[0, 63]` at `.3` — the shape is fixed — and the `speed` census on chess-search is identical to the fix's. It
  costs 23 rounds and 3,266 block visits against 6 and 852, and it changes the facts of *every* loop counter in the
  corpus (an upper bound now sits at the next constant up), which is a large change of evidence for a defect that
  has nothing to do with thresholds. It also depends on which constants happen to be in the function: `.1` lands on
  `66`, a ladder rung, not on the `64` of the guard.
* **A narrowing phase after widening** (re-solve and intersect instead of widening). It cannot recover here: by the
  time the widening phase is over, the increment block `.13` already hands the full range to `.1` (event #571
  above), so the descending iteration intersects the widened `[0, 2^31-1]` with `[-2^31, 2^31-1]` and changes
  nothing. It would fix the shape only in combination with the unstable-component rule, at which point it adds a
  second solver phase for nothing.
* **Widening only the bound that grows** is already what `intervalLattice.widen` does (`old[0]`/`old[1]` are kept
  unless they moved); both bounds of `dense` "move" at `.n18` only because the outer head moved first. The
  per-component rule above is the same idea one level up, applied to the keys of the fact.

## The framework change

`DataflowSpec.widen` was `(previous, next, block)`. It now gets the region it is applied in:

```ts
widen?(previous: V, next: V, block: string, region: FlowRegion & { readonly context: C }): V;
```

The framework concept that was missing: a widening operator is a property of a *lattice and a loop*, not of a block
id alone, and "what this loop can change" is not derivable from the fact or the block name. Without the region, an
analysis can only widen everything, which is what produced this defect. The second use would be any analysis whose
fact has components a loop cannot change (a pointer root set, a shape on a parameter); and `typed.loops` is the
domain concept, not new framework machinery. `src/workbench/workbench.ts` wraps user widenings with
`(x, y) => …`, which is unaffected.

Note, for the framework's sake: the per-key decision made here (`widen only these keys`) is a *policy* that another
analysis could reuse. If a third analysis needs it, the honest home is a `mapLattice`-level helper taking the
unstable keys, `wideningAt(unstable, inner.widen)`, rather than each analysis writing the loop.

## What changed, and the corpus

* `src/framework/dataflow/analysis.ts`: the `widen` hook takes the region; `solveArtifact` passes it.
* `src/typed/analyses.ts`: `typed.ranges` version 2; `widen` restricts itself to the head's loop's assigned locals
  (`writesOfHeads`, memoised per region); the file header still says the facts are the prototype's, which is no
  longer true — see the report.
* `tests/typed/d2-defects.test.mjs`: the F37 test loses its `todo` and also asserts the upper bound (63).
* `tests/typed/guards.test.mjs`: the `counter` test asserted the defect (`strength` must *not* change that program,
  with a comment naming the inner loop). It now asserts that `strength` makes the rewrite, and `guards` makes it
  too when it runs without `strength` in front of it.

Baselines (`02-baselines.mjs check`): one project differs, `chess-search` under `speed`.

```
typed.chess-search.speed.image: "12d8744b6c5a7c04" -> "90252eb4fa3731fc"
typed.chess-search.speed.census.strength: 58 -> 60
typed.chess-search.speed.census.guards: 4 -> 2
```

Reason: two rewrites that `guards` used to make (`.38`: `dense + ((dense / 8) << 3)` → `dense + ((dense >> 3) << 3)`,
and `.161`: `from / 16` → `from >> 4`) are now made earlier, by `strength`, which also makes them now that the ranges
know `dense ≥ 0`. Total edits are the same (58 + 4 = 60 + 2 = 62), the RV32 instruction counts at both seeds
(10 cases, seed 7; 20 cases, seed 1103) are **unchanged**, and the byte size is unchanged: only the identity of the
revision that made each rewrite (and so value ids and the image hash) moved. No project is slower.

## Later

* `intervalLattice.widen` could take the thresholds as an argument once an analysis wants them; not done, no user.
* `src/typed/backend/frequency.ts` has a private iterative Tarjan; the `cycle of a head` computation `typed.loops`
  does here is the same graph question. A framework `cycles(graph)` helper would be its second use.
* The `fits` fallback in `evalRange` is bottom-of-the-barrel precise only because intervals cannot hold
  `[2^31-1, 2^31-1] ∪ [0, 63]`; a wrapping-aware add (or an i32 interval lattice with wrap flags) would keep the
  lower bound even when the upper one is extreme.
