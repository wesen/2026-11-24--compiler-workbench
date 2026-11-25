---
id: control
title: Control flow: blocks, dominators, loops
part: Part II · Passes and facts
projects: branches, early-exit, nested-loops
---
# Control flow: blocks, dominators, loops

Blocks end in exactly one terminator: `goto`, a two-way `if … goto …
else …`, `return` or `trap`. Successors are not stored by hand; a
transaction derives them from terminators at commit, so a pass that
retargets a branch cannot leave the graph inconsistent.

## 1. The cfg pass

cfg does three things, repeatedly, until nothing changes: a branch on a
constant becomes a jump, a jump to a block that only jumps on is
retargeted past it (jump threading), and a block with one successor
whose successor has one predecessor absorbs it (merging). Unreachable
blocks are dropped at commit.

```js
const p = wb.projects.open('branches').program;
const count = () => p.fns().map(f => p.fn(f).blocks().count());
const before = count();
const r = p.apply('cfg');
return { before, after: count(), kinds: r.kinds };
```

On [Branches](project:branches), `sign` goes from 7 blocks to 5 and
`grade` from 10 to 8, with 6 retargets and 4 unreachable blocks dropped.
Lifting creates most of those: every `if` gets a join block, and an `if`
whose arms both return leaves a join no one reaches.

## 2. Dominators

Block A dominates block B if every path from the entry to B passes
through A. The workbench computes immediate dominators with the
iterative algorithm of Cooper, Harvey and Kennedy: walk the blocks in
reverse postorder, intersect the dominators of each block's processed
predecessors, repeat until stable. For `sign` it takes two rounds over 7
blocks: one to compute, one to see that nothing changes.

Dominators answer the question most passes ask: is it safe to assume
something here because it was established there? If a branch's arm
dominates a block, the branch's condition (or its negation) holds in
that block. bce rests entirely on this.

## 3. Loops

A back edge is an edge whose target dominates its source; the target is
a loop head. The loops analysis collects, for each back edge, the
natural loop: the head, the latch (the source of the back edge), the
body (every block that reaches the latch without passing the head), the
exits, the locals assigned anywhere in the body, and the preheader if
the head has exactly one predecessor outside the loop.

```js
const p = wb.projects.open('early-exit').program;
return p.fn('find')
  .loops()
  .map(l => ({
    id: l.id,
    head: l.head,
    latch: l.latch,
    body: l.body.length,
    exits: l.exits,
  }));
```

[While with break](project:early-exit) has one loop with three exits:
the loop test, the `break`, and the bounds-check trap. A break is just
another edge out.

```svg
<svg viewBox="0 0 680 200" xmlns="http://www.w3.org/2000/svg">
  <g fill="none" stroke-width="1">
    <rect x="40" y="20" width="150" height="30" class="ink f-paper"/>
    <rect x="40" y="80" width="150" height="30" class="ink f-fill"/>
    <rect x="40" y="140" width="150" height="30" class="ink f-fill"/>
    <rect x="260" y="80" width="150" height="30" class="ink f-paper"/>
    <rect x="260" y="140" width="150" height="30" class="ink f-paper"/>
    <path d="M115 50 V80 M115 110 V140 M190 95 H260 M190 155 H260" class="ink"/>
    <path d="M40 155 C10 155 10 95 40 95" class="acc dash"/>
  </g>
  <text x="115" y="40" text-anchor="middle">preheader</text>
  <text x="115" y="100" text-anchor="middle" class="b">head: i &lt; length</text>
  <text x="115" y="160" text-anchor="middle">body, latch</text>
  <text x="335" y="100" text-anchor="middle">exit: loop test fails</text>
  <text x="335" y="160" text-anchor="middle">exit: break, or trap</text>
  <text x="440" y="100" class="mut">the head dominates every block of the loop;</text>
  <text x="440" y="116" class="mut">the dashed back edge goes from latch to head</text>
</svg>
```
Figure: A natural loop. The grey blocks are the body. licm puts
invariant statements in the preheader, which runs once before the head.

In [Nested loops](project:nested-loops) the inner loop assigns `c` and
`s`; the outer assigns `r`, `c` and `s`. The assigned sets are what licm
reads: an expression is invariant in a loop if no local it reads is
assigned in that loop's body.

> **Try it.** Open the CFG view on [Insertion sort](project:sort). Loop
> heads are labelled, back edges are dashed, and blocks inside a loop
> are shaded. Then run O2 and watch the empty blocks go.

Before loops can be optimized, the workbench needs facts that flow along
these edges: [dataflow analyses](chapter:analyses).
