---
id: folding
title: Folding, simplifying, propagating, deleting
part: Part II · Passes and facts
projects: constants, dead-code, algebra
---
# Folding, simplifying, propagating, deleting

Four passes do most of the cleaning, and each needs the others. **fold** evaluates an operator whose operands are constants. **simplify** applies algebraic identities. **constprop** replaces a read of a local by a constant when every definition that reaches it assigns that constant. **dce** removes assignments nobody reads.

## 1. Each pass is small

| pass | needs | writes | rule |
|---|---|---|---|
| fold | nothing | values | `4 * 16` becomes `64`, using the evaluator's own arithmetic, so wrapping and division match |
| simplify | nothing | values | `x + 0`, `x * 1`, `x * 0` and `0 * x` (x pure), `x - x` (x pure), `x * 2^k` into a shift, `!(a < b)` into `a >= b` |
| constprop | reaching definitions | values | a read whose reaching definitions all assign the same constant |
| dce | liveness | statements | a set whose local is not live after it, if the value has no effect |

fold refuses to fold a division by zero: the trap is part of the meaning. dce refuses to remove `t = a / b` even when `t` is dead, for the same reason: `hasEffect` is true for loads, divisions and calls.

## 2. They feed each other

[Constants all the way down](project:constants) has a chain: `b = a * 4 + 2` depends on `a = 3`, `c = b - 14` on `b`.

```js
const p = wb.projects.open('constants').program;
const rounds = [];
for (let i = 0; i < 4; i++) {
  const f = p.apply('fold');
  const c = p.apply('constprop');
  const s = p.apply('simplify');
  rounds.push([f.edits, c.edits, s.edits]);
  if (!f.edits && !c.edits && !s.edits) break;
}
p.apply('dce');
return { rounds, listing: p.listing() };
```

Measured, as [fold, constprop, simplify] edits per round: `[0, 2, 1]`, `[2, 2, 1]`, `[0, 1, 1]`, `[0, 0, 0]`. Three rounds of work, a fourth to see that nothing is left, and the function is `return ((x * 14) + 9)`. The first round folds nothing because nothing is constant yet except the literals; constprop has to move `3` into `a * 4` first. This is the classic phase-ordering problem in miniature, and a pipeline that runs each pass once would stop at round one.

## 3. Dead code and dead blocks

[Dead stores](project:dead-code) has an unused local, a `const debug = false` guarding a block, and `if (1 > 2)`. After O1 the function is two statements in one block:

```text
bb:pick.0  -> []
    s:pick.1     y = (x + 1)
    s:pick.12    return (y << 1)
```

From 7 blocks at r0. constprop turns `debug` into `0`; fold turns `1 > 2` into `0`; cfg turns both branches into jumps and the blocks behind them become unreachable; dce removes the stores to `unused` and `debug`. Every removal is an edit with a because: dce cites the liveness fact, cfg the constant condition. The RV32 image goes from 60 bytes to 12.

## 4. What is still missing

[Algebraic identities](project:algebra) ends O1 as

```text
s:tidy.0     a = x
s:tidy.1     b = y
s:tidy.3     return (a + b)
```

The identities all went (`z` became `x * 0`, then `0`, then disappeared into `+ 0`, which the second simplify removed), but `a = x` is a copy, and nothing in O1 propagates copies. In O2, subst substitutes each copy into its single reader and the function is `return (x + y)`. The second simplify in O1 is there because constprop creates new work for it: `+ 0` only appears once constprop has replaced `z` by its constant.

You can see the trap rules at work on two lines of your own:

```js
const q = wb.program(
  'traps',
  'function f(x: i32): i32 { const t = x / 0; return 5; }\n' +
    'function g(x: i32): i32 { return 7 / 0; }',
);
q.pipeline('O1', { checkEach: false });
return q.listing();
```

`t = (x / 0)` stays although `t` is dead, and `7 / 0` stays unfolded: both still trap, as the original did.

> **Exercise.** Write a `copyprop` pass that replaces a read of `a` by `x` when the only reaching definition of `a` is `a = x` and `x` is not assigned between. It needs reaching definitions; the bce source has a helper that resolves a read through one copy.

Next: [control flow](chapter:control), where cfg and the graph analyses live.
