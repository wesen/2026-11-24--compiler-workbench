---
id: loops
title: Moving code out of loops
part: Part II · Passes and facts
projects: licm-nested, licm-traps, value-numbering, nested-loops
---
# Moving code out of loops

Three passes work on loops and repeated work: **licm** moves invariant expressions to a preheader, **lvn** computes a repeated expression once per block, and **subst** substitutes single-use temporaries back into their reader so the next round sees whole trees again.

## 1. Loop-invariant code motion

An expression is invariant in a loop if it is pure and no local it reads is assigned in the loop. licm walks each loop, finds maximal invariant subtrees of the statements in the body, gives each a new local (`inv`, `inv1`, …), assigns it in the preheader (making one if the head has none), and replaces the original. The because of each move is the loop fact: `loop:blend@bb:blend.1`.

[Hoisting through two loops](project:licm-nested) has one expression invariant in both loops and one only in the inner:

```js
const p = wb.projects.open('licm-nested').program;
const before = p.compile().run('table', [10, 10, 3, 4]).steps;
p.apply('licm');
const after = p.compile().run('table', [10, 10, 3, 4]).steps;
return { before, after, listing: p.listing() };
```

One run places all three: `a * b + 7` and `a + b` in the outer preheader, `r * inv1` in the inner one, since the outer loop assigns `r`. On rows = cols = 10, the image runs 955 instructions before and 568 after.

## 2. What licm must not move

Purity is the whole safety argument. `a / b` in [What licm must not hoist](project:licm-traps) is invariant (neither `a` nor `b` is assigned in the loop), but it can trap. If the loop runs zero times, the original never divides; a hoisted division would trap on `b = 0` where the original returned 0. So `isPure` is false for div, rem, loads and calls, and licm leaves them where they are:

```js
const p = wb.projects.open('licm-traps').program;
const r = p.apply('licm');
const div = p.fn('ratio').values().op('div').first();
return { edits: r.edits, pure: div.isPure, effect: div.hasEffect };
```

A real compiler would hoist the division into a guarded preheader (run it only if the loop runs at least once) or prove `b ≠ 0`. Both would be passes you can write against the same API; the check after each pass will tell you if you got the guard wrong.

## 3. Value numbering, and its bug

lvn looks within a block for two statements that compute the same pure tree (`same()` compares trees structurally) and computes it once into a new local `vn`. In [The same expression twice](project:value-numbering), `i * 3 + 7` appears twice per iteration; after lvn, the image runs 570 instructions for n = 40 instead of 690, with the same result, 720.

The first version of lvn had a bug that the check after the pass caught at once. It inserted `vn = (i * 3 + 7)` before the first use, then replaced both occurrences of the tree with reads of `vn`, and the replacement walked every statement in the block, including the one it had just inserted. The new statement became `vn = vn`.

```text
lvn        r3   edits 5 {local:1, insert:1, replace:3}  | halves 61/150
           BAD { args: [1024, 37], expected: 625, got: 18 }
```

Sixty-one of 150 cases still agreed, which is why a single hand-picked test could easily have missed it. The fix was to replace first and insert after. The pass is 20 lines; the check that caught it is the same check that runs after every pass in every pipeline.

## 4. Forward substitution

Lifting and licm leave temporaries: `t7 = i` before every bounds check, `inv = …` in preheaders. subst replaces a local that is assigned once, from a pure value, and read once in the same block, by the value itself, and removes the assignment. It needs liveness to know the local is not read later. It handles one per block per run, because liveness changes after each, which is why O2 runs it twice. In [Algebraic identities](project:algebra) it is what turns `a = x; b = y; return a + b` into `return x + y`.

> **Exercise.** licm hoists out of one loop at a time but hoists maximal subtrees. Find a program where running it twice does more than running it once, or argue that none exists for this pass.

[Bounds checks](chapter:bounds) are next, the pass that uses the most facts at once.
