---
id: passes
title: The pass manager
part: Part II · Passes and facts
projects: my-first-pass, params-demo, first-steps
---
# The pass manager

A pass is a function over one function of the program at a time, with
three declarations around it: the **facts it needs**, the **kinds of
entities it writes**, and the **facts it preserves**. The pass manager
uses the first to compute facts before the pass runs, the second to
refuse writes the pass did not announce, and the third to decide which
cached facts go stale afterwards.

## 1. A pass in twelve lines

[Write a pass](project:my-first-pass) defines `add-self`, which turns `x +
x` into `x * 2`:

```js
wb.pass('add-self')
  .about('x + x, for a pure x, becomes x * 2')
  .writes('values')
  .preserves('cfg', 'dominators', 'loops', 'liveness', 'reaching')
  .run((fn, tx) => {
    tx.rewrite(v => {
      if (v.op === 'add' && v.args[0].isPure && v.args[0].same(v.args[1]))
        return tx.make('mul', v.args[0].id, tx.const(2), {
          because: [v.args[1].id],
          note: 'x + x = x * 2',
        });
    });
  });
const p = wb.projects.open('my-first-pass').program;
p.apply('add-self');
p.apply('simplify');
return p.listing();
```

Its run rewrote `x + x` to `(x * 2)` and `(y + 1) + (y + 1)` to `((y + 1) *
2)`; simplify then made both shifts, and the check against r0 agreed.
Note `isPure`: `load(p) + load(p)` must not become `load(p) * 2` if the
load can trap, and `call() + call()` must not either.

## 2. Transactions

`tx` is the only way a pass changes anything. It makes values (`const`,
`make`, `get`), locals and statements, places statements (`insert` at
`tx.at.before(stmt)` and friends), removes them (with a required
`because`), moves them, changes fields and branch targets, makes blocks,
and rebuilds trees (`rewrite`, `replace`). Every one of these records an
edit with an id like `edit:r6.1`, and every new entity gets an origin:
made from the value being visited, by this pass, at this revision, with
the because list you gave.

At commit, successors are derived from each block's terminator and
blocks no one can reach are dropped, each as an `unreachable` edit. If
the pass throws, the program is restored from the previous revision's
snapshot: half a pass never happens.

## 3. Facts, needs and staleness

```js
const p = wb.projects.open('blend').program;
p.pipeline('O2', { checkEach: false });
return p.facts();
```

After O2 on Blend, five facts are fresh at r6 and one is stale:
`fact:loops(blend)@r5`, made stale by licm at r6. licm writes statements
and blocks and preserves nothing, so whatever was cached before it,
other than what later passes recomputed, is marked stale with the pass
that did it. A stale fact is never used: asking for it computes a fresh
one at the current revision. That is the whole invalidation protocol,
and it is why `preserves` matters: a pass that preserves liveness saves
the next pass from recomputing it, and a pass that wrongly claims to
preserve it makes the next pass read a lie. The workbench cannot catch
the second case directly; the checks after each pass catch its
consequences.

## 4. Pipelines and parameters

A pipeline is a list of passes, possibly with repeats, checked after
each pass that changes something. O1 is `cfg fold simplify constprop
fold simplify dce cfg`; O2 adds `licm lvn strength bce subst subst dce
cfg`. `p.pipeline(['cfg', 'dce'])` runs any list.

```js
const plan = wb.pipeline('to-fixpoint')
  .pipe('fold')
  .pipe('constprop')
  .repeat('unchanged', b =>
    b.pipe('simplify').pipe('fold').pipe('constprop').pipe('dce'),
  )
  .checkEach(true, { count: 40 })
  .build();
return plan.explain();
```

A script can also declare parameters, which become sliders.
[Parameters](project:params-demo) declares a pipeline choice, a register
count, a toggle and an input size, and reports bytes and instructions.
Measured on its 40-cell input with n = 20:

| pipeline | 2 registers | all registers |
|---|---|---|
| O0 | 208 bytes, 529 instructions | 156 bytes, 286 instructions |
| O1 | 192 bytes, 506 instructions | 140 bytes, 282 instructions |
| O2 | 184 bytes, 447 instructions | 132 bytes, 242 instructions |

Every cell returns 1876. A parameter should change the cost, never the
answer.

> **Try it.** Open [Parameters](project:params-demo), run its script
> from the Console, then move the sliders in the Pipeline view.

The next three chapters go through the built-in passes, beginning with
[the folding family](chapter:folding).
