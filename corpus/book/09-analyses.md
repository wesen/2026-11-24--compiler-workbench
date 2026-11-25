---
id: analyses
title: Analyses, lattices, and a widening bug
part: Part II · Passes and facts
projects: my-analysis, strength, checksum
---
# Analyses, lattices, and a widening bug

Every dataflow analysis in the workbench, built in or yours, is solved
by one function: `WB.solve` in `app/engine/analyses.js`. It takes a
direction, a lattice (bottom, join, equality, maybe widening), a
transfer function over blocks and an optional edge function, and
iterates over the blocks in reverse postorder until nothing changes.

## 1. The built-in analyses

| analysis | direction | lattice | used by |
|---|---|---|---|
| liveness | backward | sets of locals | dce, subst, the backend's zeroing of locals |
| reaching | forward | sets of definitions | constprop, bce |
| ranges | forward | a map from local to interval | strength, bce, the backend's division checks |
| dominators, loops, cfg | graph algorithms, not dataflow | | cfg, licm, bce |

On Blend after O2, liveness needs 18 block visits and ranges 30; both
take well under a millisecond.

## 2. Writing one

[Write an analysis](project:my-analysis) asks which locals may have been
reassigned, after their declaration, on some path to each block:

```js
wb.analysis('reassigned')
  .about(
    'locals assigned again, after the entry block, on some path to each block',
  )
  .forward()
  .lattice(wb.lattice.set())
  .transfer((block, inn) =>
    block.preds().length ? new Set([...inn, ...block.defs()]) : inn,
  )
  .register();
const p = wb.projects.open('my-analysis').program;
const fact = p.fn('f').fact('reassigned');
return { id: fact.id, visits: fact.visits };
```

It settled in 14 block visits. The entry adds nothing (it only declares
`a` and `b`); the two arms of the `if` add `a` and `b`, the loop adds
`a`, and every block after the join sees both. The fact is cached as
`fact:reassigned(f)@r0` and goes stale like any other.

## 3. Intervals need widening

Sets of locals have finite height: a fixpoint comes. Intervals do not: a
loop that adds one to `i` produces `[0, 0]`, `[0, 1]`, `[0, 2]`, and so
on for four billion rounds. Widening jumps: after a few rounds, a bound
that is still moving goes straight to the type's limit. The solver
refuses an infinite-height lattice that has no widening (`noWidening`).

Ranges also **refine on branches**: on the edge where `i < n` is true,
`i`'s upper bound drops to the upper bound of `n` minus one, even if
nothing is known about `n`, because nothing is less than the largest
`i32`.

## 4. The bug

The first version of the solver widened the out-value of every block
after three visits. On [Checksum](project:checksum) that meant:

```svg
<svg viewBox="0 0 680 180" xmlns="http://www.w3.org/2000/svg">
  <g font-family="ui-monospace, Menlo, monospace" font-size="10.5">
    <text x="10" y="20" class="lbl mut">round</text><text x="80" y="20" class="lbl mut">head: i</text><text x="250" y="20" class="lbl mut">body after refining i &lt; length</text><text x="480" y="20" class="lbl mut">after i = i + 1</text>
    <text x="10" y="44">1-3</text><text x="80" y="44">[0, 0] [0, 1] [0, 2]</text><text x="250" y="44">the same</text><text x="480" y="44">[1, 1] … [1, 3]</text>
    <text x="10" y="70">4, before</text><text x="80" y="70">[0, max]</text><text x="250" y="70" class="acc">widened again: [0, max]</text><text x="480" y="70" class="acc">overflows: [min, max]</text>
    <text x="10" y="96">4, after</text><text x="80" y="96">[0, max]</text><text x="250" y="96">[0, max - 1]</text><text x="480" y="96">[1, max]</text>
    <text x="10" y="130" class="mut">before the fix every block widened its own out-value, so the body threw away</text>
    <text x="10" y="146" class="mut">the refinement it had just made; widening only at loop heads keeps it</text>
  </g>
</svg>
```
Figure: The intervals of `i` in `total`, before and after widening was
restricted to loop heads. With the bug, `i` was unknown at the loop
test, and bce could not prove the index was not negative.

The body block refined `i` to `[0, max - 1]` on entry, but its own
out-value was then widened against the previous round, which pushed the
upper bound back to `max`; `i + 1` overflowed, and `i` became the whole
range. The fix is the textbook one: widen only where a back edge enters,
at loop heads. After it, ranges proves `i ≥ 0` at the bounds check and
bce removes it.

The symptom was a pass that silently did nothing, which no check can
catch, because doing nothing is always correct. It was found by asking
why a project's note was wrong, and reading the interval the fact gave
for `i` at the loop test:

```js
const p = wb.projects.open('checksum').program;
const f = p.fn('total');
const head = f.blocks().list()[1];
return { head: head.id, i: f.fact('ranges').value.in.get(head.id) };
```

> **Exercise.** ranges refines on `<`, `<=`, `>` and `>=` but not on
> `===` or `!==`. Add `!==` against a constant (the interval cannot
> shrink, but `x !== 0` on `[0, n]` gives `[1, n]`).
> [Euclid](project:gcd) is the program that needs it.

[Loops](chapter:loops) uses these facts to move code.
