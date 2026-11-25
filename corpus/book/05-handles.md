---
id: handles
title: Handles, selections and diagnostics
part: Part I · The workbench
projects: diagnostics, fragments
---
# Handles, selections and diagnostics

Nothing outside the engine touches an entity directly. You get a **handle**: a read-only proxy that answers the members its kind has, computes derived ones on demand, and refuses everything else with a reason.

## 1. Asking

```js
const p = wb.projects.open('blend').program;
const f = p.fn('blend');
const mul = f.values().op('mul').first();
return {
  text: mul.text,
  args: mul.args.map(a => a.text),
  pure: mul.isPure,
  in: mul.statement,
  lines: mul.lines(),
};
```

Every handle has `id`, `kind`, `status`, `text`, `describe()`, `origin()`, `lineage()`, `lines()`, `why()` and `history()`. Kinds add their own: a value has `op`, `args`, `isConst`, `isPure`, `hasEffect`, `reads`, `same(other)`; a block has `succ`, `preds()`, `defs()`, `uses()`; a function has `blocks()`, `stmts()`, `values()`, `ops()`, `locals()`, `loops()`, `fact(name)`. The Reference lists them all.

## 2. Selections

`blocks()`, `stmts()`, `values()` and `ops()` return selections, which compute nothing until asked. They chain:

```js
const f = wb.projects.open('sort').program.fn('sort');
return {
  loads: f.values().op('load16u').count(),
  line5: f.ops().line(5).count(),
  sets: f.stmts()
    .where(s => s.op === 'set')
    .take(4)
    .table('id', 'localName', 'text'),
};
```

A selection's `result()` gives a count with its witnesses and the revision it was taken at, which is what an answer about a program should carry.

## 3. Being refused

[Mistakes and the errors they get](project:diagnostics) makes five deliberate mistakes. The answers it gets, verbatim from its run:

```text
typo:      [unknownMember] Function has no member "blokcs". Did you mean "blocks"?
assign:    [immutable] Function is read-only; assigning .name has no effect.
noWrites:  [undeclaredWrite] pass "sneaky" made a constant (it changes values) but declares writes().
             fix: .writes('values')
noBecause: [missingBecause] tx.remove(s:f.0) needs { because: [...] }: the facts or entities that make the removal valid
badPass:   [unknownPass] no pass named "constant-fold".
```

Each has a code to branch on, a message for a person, and usually a `fix:` line. The member list on `unknownMember` is the real list of that kind. A pass that throws leaves the program exactly as it was: the transaction's revision is never recorded.

> **Caveat.** The handles are opaque in the sense that the API offers no way around them. This is a page, not a sandbox: code in the browser's own console can reach anything. The guarantees are about the API, which is what passes, views and the agent use.

## 4. Fragments

A fragment adds members to a kind of handle without changing the engine. [Fragments](project:fragments) gives every value a `cost` and every function a `cost()`:

```js
if (!wb.fragments().some(f => f.name === 'cost'))
  wb.fragment('cost')
    .on('Value')
    .attr(
      'cost',
      v =>
        ({ mul: 3, div: 34, rem: 34, load: 2, load16u: 2, call: 5 })[
          v.op
        ] ?? 1,
    )
    .on('Function')
    .method('cost', f => f.values().sum(v => v.cost));
wb.use('cost');
return wb.projects.open('fragments').program.fn('blend').cost();
```

With these made-up weights Blend costs 75 at r0 and 70 after O2. Before `wb.use('cost')`, asking for `.cost` fails with an error that names the fragment providing it. Two fragments in use that define the same member are refused with `fragmentConflict`.

Part II starts with [the pass manager](chapter:passes).
