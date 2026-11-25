---
id: division
title: Division: semantics, shifts, and a wrong pass
part: Part II · Passes and facts
projects: wrong-shift, strength, div-checks, div-magic, gcd
---
# Division: semantics, shifts, and a wrong pass

The typed language follows WebAssembly: `x / 0` traps, `INT_MIN / -1`
traps (the quotient does not fit), `x % 0` traps, and `INT_MIN % -1` is 0.
Division rounds toward zero. RISC-V disagrees on the first three: its
`div` returns -1 for `x / 0` and never traps. Every one of these
differences is somewhere a compiler can go wrong.

## 1. A pass that is wrong for negatives

div-to-shift rewrites `s / 8` as `s >> 3`. For `s ≥ 0` they agree. For
negative `s` they do not, because an arithmetic shift rounds toward
minus infinity: `-15 >> 3` is -2, `-15 / 8` is -1. The pass is in the
workbench on purpose. [A pass that is wrong for
negatives](project:wrong-shift):

```js
const p = wb.projects.open('wrong-shift').program;
p.apply('div-to-shift');
const c = p.check({ count: 100 });
return c.fns.map(f => ({
  fn: f.fn,
  agree: f.agree,
  total: f.total,
  first: f.counterexamples[0],
}));
```

`eighth` agrees on 58 of 100 cases, `bucket` on 86. The first
counterexample is `eighth(-100)`: expected -12, got -13. The check does
not know about rounding; it only knows the two programs disagree on an
input, and shows the input.

## 2. Doing it right with ranges

strength makes the same rewrite only where the ranges fact proves the
dividend is not negative. In [Strength reduction with
ranges](project:strength), `level` is kept in `[0, 1000]` by `Math.min`,
and ranges says so at the return; `level / 4 + level % 8` becomes
`(level >> 2) + (level & 7)`. In `signed`, `x` can be anything, and
strength leaves it alone. The edit cites the fact, so `p.why()` on the
new shift leads to the interval.

When ranges cannot see the bound, nothing happens: in
[Collatz](project:collatz) the loop test `x > 1 && steps < 1000` is
lowered into a temporary (`&&` is control flow), the body is guarded by
a test of that temporary, and ranges never learns `x > 1`. The `x % 2`
and `x / 2` stay divisions.

## 3. The checks the backend adds

Since RISC-V does not trap, the backend must. For a general `a / b` it
emits a zero test and an overflow test before the `div`:

```text
bne  b, zero, L0      # b ≠ 0: go on
ebreak                # division by zero
L0: addi k, zero, -1
bne  b, k, L1         # b ≠ -1: go on
lui  m, 0x80000
bne  a, m, L1         # a ≠ INT_MIN: go on
ebreak                # integer overflow
L1: div  q, a, b
```

The backend reads the ranges fact (option `useRanges`) and drops each
test it can prove unnecessary. In [Division checks](project:div-checks),
`safeShare` clamps the divisor with `Math.max(1, Math.min(people, 10))`:
with `useRanges` on it compiles to 56 bytes with no `ebreak`; off, to 92
bytes with three. `share` divides by an unknown and keeps both tests in
either case.

## 4. Division by constants

A division by a constant that is not a power of two can be a
multiply-high and shifts. The backend's tile for it uses
`divisionMagic`, reused unchanged from the repo's compiler (Hacker's
Delight, figure 10-1). For 7 the magic number is `0x92492493`; the
listing of `sevenths` in [Division by constants](project:div-magic)
shows `lui t0, 0x92492` and `addi t0, t0, 1171` building it, then
`mulh`, an add (the magic is negative as a signed number), a shift and a
sign correction.

Is it worth it? On the emulator, no:

| `digitsum(987654321)` | bytes | instructions |
|---|---|---|
| with divmagic | 76 | 107 |
| without | 60 | 71 |

The emulator counts instructions, and a `div` is one instruction. On a
core where `div` takes 30 or more cycles and `mulh` a few, the first row
wins. The workbench measures what it can measure; the book says which
cost model the number is in.

> **Exercise.** [Euclid](project:gcd) keeps a zero check on `x % y`
> although the loop test is `y !== 0`. Teach ranges to refine on `!==`
> (see [chapter 9](chapter:analyses)), then check that the `ebreak` goes
> and the check still agrees.

Part III asks how the workbench knows any of this is right:
[checks](chapter:checks).
