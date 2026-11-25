---
id: bounds
title: Bounds checks and the facts that remove them
part: Part II · Passes and facts
projects: checksum, bounds-two, bounds-offset, bounds-param, histogram
---
# Bounds checks and the facts that remove them

Every `work.charCodeAt(i)` carries a check: if `i >=u work.length`,
trap. The unsigned compare catches negative indices too. In a loop over
a buffer that is one load, one compare and one branch per element, and
in [Checksum](project:checksum) it is a quarter of the loop.

## 1. Three facts

bce removes a check `if (t >=u load32[buf+0]) goto trap` when it can
show three things:

1. **A dominating test.** Walking up the dominator tree from the check,
   some branch tests `i < buf.length` (or `i >= buf.length`, taken the
   other way) and the arm where it holds dominates the check.
   Dominators.
2. **The same `i` and the same buffer.** The check reads a temporary `t7
   = i`; bce resolves it through that one copy, then requires that the
   definitions of `i` and of `buf` reaching the test are the ones
   reaching the check. Reaching definitions.
3. **`i` is not negative.** `i < length` alone does not prove `i >=u
   length` is false: `-1 < 5`, but as unsigned `-1` is huge. Ranges must
   give `i` a lower bound of at least 0 at the test.

When all three hold, the check becomes `goto` its continuation, the trap
block becomes unreachable, and the edit's because names the evidence:

```text
edit:r3.0  bce  replaceStmt  s:total.5 → goto .7
           because: s:total.3, fact:ranges(total): i ≥ 0
           note: s:total.3 already proved i < length
```

On a 40-cell buffer, Checksum's image goes from 64 bytes and 446
instructions at r0 to 52 bytes and 366 after O2.

## 2. Three bugs, two of them in bce

The first version of bce never fired. Its helper resolved a read through
one copy only if the single reaching definition was not a parameter,
testing that with `!id.includes(':')`, since parameter definitions are
named `param:0`. Every statement id contains a colon too (`s:total.4`),
so it rejected all of them. The second problem was in simplify's favour:
simplify rewrites `!(i < len)` into `i >= len`, and bce only knew `lt`.
The third was the widening bug of [chapter
9](chapter:analyses#4-the-bug), which left `i` with no lower bound.

None of the three broke a check, because a bounds check that stays is
always correct. They were found because the project's note promised the
check would go and the Timeline showed no bce revision.

## 3. Where bce stops

| project | what stays, and why |
|---|---|
| [Two buffers](project:bounds-two) | the loop runs to `a.length`, so `b`'s check stays: 2 traps before O2, 1 after |
| [Reading the next element](project:bounds-offset) | the test is `i + 1 < length` and the read is at `i + 1`; bce matches locals, not trees |
| [A loop to n](project:bounds-param) | nothing ties `n` to the length; cases with `n` beyond it trap, in both engines |
| [Insertion sort](project:sort) | all 6 checks stay: `j - 1` is not a loop variable |
| [Histogram](project:histogram) | `k = cell / 10` has range `[0, 6553]`, not enough for a 4-cell buffer |

```js
const p = wb.projects.open('bounds-two').program;
const traps = () =>
  p.fn('dot')
    .stmts()
    .where(s => s.op === 'trap')
    .count();
const before = traps();
p.pipeline('O2');
const c = p.check({ count: 200 });
return {
  before,
  after: traps(),
  agree: c.fns[0].agree,
  bothTrap: c.fns[0].bothTrap,
};
```

In 200 cases of Two buffers, 97 trap in both the optimized program and
r0, because `b` is often shorter than `a`. A trap is an outcome like any
other: the check requires the same one.

> **Exercise.** Make bce compare value trees with `same()` instead of
> locals, so Reading the next element loses its check on `i + 1`. Then
> ask what proves the check on `i` redundant too.

[Division](chapter:division) has the same shape: a check the language
requires, and facts that sometimes remove it.
