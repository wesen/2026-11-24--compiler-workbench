---
id: provenance
title: Provenance: where things came from, and why they are valid
part: Part I · The workbench
projects: blend
---
# Provenance: where things came from, and why they are valid

Every entity carries an `origin`: a list of records `{ from, via, rev, because, note }`. `from` is what it was made from, `via` the pass (or `ingest`), `rev` the revision, and `because` the facts or entities that make it valid. A transaction fills these in by default, so a pass gets provenance without asking for it.

## 1. Two questions, two walks

- **Lineage** follows `from` and value arguments down to front-end ops. It answers: which source does this come from?
- **Why** follows both `from` and `because`, as a tree. It answers: what made this, and what justified it?

Here is the why tree of the statement licm put in Blend's preheader, as `p.why('s:blend.15')` returns it after O2:

```text
s:blend.15  inv = ((a * b) + 64)        live · via licm · r6 · hoisted out of loop:blend@bb:blend.1
  made from v:blend.37  ((a * b) + 64)  live · via constprop · r4 · rebuilt around a changed argument
    made from v:blend.25  ((a * b) + scale)   detached · via ingest
      made from op:blend#35  i32.add (line 5)
  because loop:blend@bb:blend.1
```

```svg
<svg viewBox="0 0 680 170" xmlns="http://www.w3.org/2000/svg">
  <g fill="none" stroke-width="1">
    <rect x="10" y="60" width="130" height="40" class="ink f-paper"/>
    <rect x="190" y="60" width="130" height="40" class="ink f-paper"/>
    <rect x="370" y="60" width="130" height="40" class="mut f-fill"/>
    <rect x="550" y="60" width="120" height="40" class="mut f-fill"/>
    <rect x="190" y="125" width="190" height="34" class="acc f-sel"/>
    <path d="M140 80 H190 M320 80 H370 M500 80 H550" class="ink"/>
    <path d="M75 100 V142 H190" class="acc dash"/>
  </g>
  <text x="75" y="77" text-anchor="middle" class="b">s:blend.15</text><text x="75" y="92" text-anchor="middle" class="mut">licm, r6</text>
  <text x="255" y="77" text-anchor="middle" class="b">v:blend.37</text><text x="255" y="92" text-anchor="middle" class="mut">constprop, r4</text>
  <text x="435" y="77" text-anchor="middle" class="b">v:blend.25</text><text x="435" y="92" text-anchor="middle" class="mut">ingest, detached</text>
  <text x="610" y="77" text-anchor="middle" class="b">op:blend#35</text><text x="610" y="92" text-anchor="middle" class="mut">line 5</text>
  <text x="285" y="146" text-anchor="middle" class="acc">loop:blend@bb:blend.1</text>
  <text x="10" y="30" class="mut">solid: made from (origin) · dashed: because</text>
</svg>
```
Figure: The lineage of the hoisted statement. The origin chain runs to line 5; the because edge names the loop fact whose preheader received the statement.

## 2. Statuses

`p.statusOf(id)` answers for any id, including ones no longer in the program:

| status | meaning |
|---|---|
| `live` | reachable from the current blocks |
| `removed@r5` | a pass removed this statement at r5 |
| `replaced@r4` | an edit at r4 replaced it with something else |
| `detached` | a value no longer in any tree, usually because its parent was rebuilt |

Removed things keep their fields, so after O2 `p.get('s:blend.0').text` still reads `scale = 64`, the statement as it was when dce removed it at r5. (fold had rewritten its value at r2: statement fields change in place, and each revision's snapshot keeps the old ones.)

## 3. From instructions back to source

Instructions are entities too. Each records the values and statement it **covers**: the instruction `mul t2, a2, a3` in the O2 image of Blend covers `v:blend.23` and `s:blend.15`, so its lines are `[5]`. That is how the RV32 view shows a source line beside each instruction, and how `img.heat()` turns execution counts into counts per line: on a 40-cell run, line 5 accounts for 322 of the 451 instructions executed.

```js
const p = wb.projects.open('blend').program;
p.pipeline('O2');
const img = p.compile();
return {
  mul: img.insns('blend').find(i => i.text.startsWith('mul')),
  related: p.related('op:blend#33'),
};
```

`p.related(id)` runs the other way: from an op (or anything) to every live value, statement and instruction that came from it. Selecting a line number in the Source view does exactly this.

> **Try it.** In the RV32 view, click an instruction id. Lineage shows its whole chain down to the op; Source highlights the line.

[Handles](chapter:handles) covers the read side of the API: what you can ask an entity, and what happens when you ask wrongly.
