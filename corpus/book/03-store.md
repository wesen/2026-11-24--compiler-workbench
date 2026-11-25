---
id: store
title: The store, lifting, and revisions
part: Part I · The workbench
projects: blend, dead-code
---
# The store, lifting, and revisions

The workbench does not keep an IR in the sense of a language with a printer and a parser. It keeps a **store** of entities, each with a readable id, a kind, its fields and its origin, and offers queries, views and transactions over it. The listing you see in the IR view is one view of the store, not its definition.

## 1. Entities and ids

| kind | id | example from Blend at r0 |
|---|---|---|
| function | `fn:blend` | `blend(work: buffer, n: i32, a: i32, b: i32): i32` |
| block | `bb:blend.1` | 1 statement, successors .2 and .3 |
| statement | `s:blend.10` | `s = (s + (load16[...] * ((a * b) + scale)))` |
| value | `v:blend.23` | `(a * b)` |
| op | `op:blend#35` | `i32.add (line 5)`, as the front end emitted it |
| local | `local:blend/scale` | a named local of the function |

Blend at r0: 50 front-end ops, 7 blocks, 13 statements, 34 values in the statement trees, 8 locals. Ids never change meaning. A statement a pass removes keeps its id and its fields; its status becomes `removed@r5`, so its history can still be read.

## 2. Lifting stack code into trees

The front end emits stack code. The store holds **statements over value trees**: `set`, `store`, `eval`, `br`, `br_if`, `return`, `trap`, each with one or more trees of values (`add`, `load`, `get`, `const`, and so on). A value has exactly one user, so a tree is a tree, not a DAG.

```svg
<svg viewBox="0 0 680 190" xmlns="http://www.w3.org/2000/svg">
  <g font-family="ui-monospace, Menlo, monospace" font-size="10.5">
    <text x="10" y="20" class="lbl mut">stack code, line 5 (part)</text>
    <text x="10" y="42">local.get 2</text><text x="10" y="58">local.get 3</text><text x="10" y="74">i32.mul</text>
    <text x="10" y="90">local.get 4</text><text x="10" y="106">i32.add</text>
    <text x="320" y="20" class="lbl mut">value tree</text>
  </g>
  <g fill="none" stroke-width="1">
    <path d="M110 70 H290" class="mut dash"/>
    <rect x="420" y="30" width="120" height="26" class="ink f-paper"/>
    <rect x="340" y="90" width="110" height="26" class="ink f-paper"/>
    <rect x="510" y="90" width="110" height="26" class="ink f-paper"/>
    <rect x="300" y="150" width="70" height="26" class="ink f-paper"/>
    <rect x="390" y="150" width="70" height="26" class="ink f-paper"/>
    <path d="M480 56 L395 90 M480 56 L565 90 M395 116 L335 150 M395 116 L425 150" class="ink"/>
  </g>
  <text x="480" y="47" text-anchor="middle">add v:blend.25</text>
  <text x="395" y="107" text-anchor="middle">mul v:blend.23</text>
  <text x="565" y="107" text-anchor="middle">get scale</text>
  <text x="335" y="167" text-anchor="middle">get a</text>
  <text x="425" y="167" text-anchor="middle">get b</text>
</svg>
```
Figure: Lifting turns operand-stack code into trees. Each value keeps the op that made it as its origin: `v:blend.23` came from `op:blend#33`, the `i32.mul`.

Lifting simulates the operand stack, but it cannot always leave values on it. Before a local the stack still reads is assigned, before a store or a call, and around control flow, it **materializes** the stack into temporaries. That is where `t7 = i` in Blend comes from: the index is copied before the bounds check so the check and the load see the same value. Lifting also turns structured `block`, `loop` and `if` into blocks with explicit successors, and `unreachable` into a `trap` statement.

```text
bb:blend.3  -> [.4, .5]
    s:blend.5    t7 = i
    s:blend.6    if (t7 >=u load32[work+0]) goto .4 else .5
bb:blend.4  -> []
    s:blend.7    trap
bb:blend.5  -> [.7]
    s:blend.9    goto .7
```

The empty block `.5` is lifting's too: the end of the `if` falls through to a join. The cfg pass threads it away in its first revision.

## 3. Revisions

A program is a list of revisions. r0 is ingest. Every pass that changes something records one revision: its edits, a snapshot of the mutable parts (blocks, their statement lists, locals, statement fields), and how long it took. Values are never changed in place, only rebuilt, so old trees stay valid for history.

```js
const p = wb.projects.open('dead-code').program;
p.pipeline('O1');
return p.revisions();
```

[Dead stores and a branch that never runs](project:dead-code) goes from 7 blocks to 1 and ends as two statements. `p.checkout('r2')` goes back and drops later revisions; `p.undo()` drops one. `p.edit(source)` starts a new program at r0 under the same name.

> **Try it.** In the Timeline view, click a revision to see its edits, and the id of an edit's statement to select it everywhere.

[Provenance](chapter:provenance) is next: what the origin and because fields of each entity say, and how to read them.
