---
id: welcome
title: A workbench, not a compiler
part: Part I · The workbench
projects: blend, first-steps
---
# A workbench, not a compiler

This page compiles programs in a small typed language to RISC-V machine code and runs them, but the compiler is not the point. The point is to see what a compiler knows at each step, where every piece of the program came from, and why each change was allowed. Every number in this book was measured by running the workbench on its own projects.

## 1. What is on the screen

The header names the open project, its revision and the last check. Under it are four tiles:

- **Files**, **Projects** and **Scripts** on the left: the open project's files, 44 projects to study, and the project's scripts. A project is a folder of plain files: typed sources, workbench scripts that query and experiment, and UI scripts that add tiles of their own ([Projects and the UI DSL](chapter:projects)).
- **Source, IR, CFG, Lineage, Facts** in the middle: the program as written, as lifted into blocks of statements, as a graph, the provenance of whatever is selected, and the analyses' results.
- **Pipeline, Timeline, Checks, RV32, Run, Console** underneath: what to run next, what has run, whether the meaning survived, the machine code, single runs, and a JavaScript console.
- **Agent, Book, Reference** and **Code** on the right: an agent that drives the same API you do, this book, the API itself, and the workbench's own source.

A project's UI scripts add more: [Start here](project:start-here) puts a status board, an O2 report and a next-pass helper beside the source.

That is only the default. Every tab can be dragged by its label: onto another tile's tab strip to move it there, onto the middle of a tile to add it to that tile, or onto a tile's edge to split the tile and give the view half of it. Gutters resize, × closes a view and + in any tile brings it back, ⤢ maximizes a tile, and the **Layout** menu has four arrangements (Workbench, Reading, Compiler, Agent). Whatever you arrange is kept in this browser.

Select anything (a statement in IR, a line number in Source, an instruction in RV32) and every view highlights what is related to it.

## 2. One program, start to finish

Open [Blend](project:blend). It has a constant to fold, an expression to move out of a loop, and a bounds check on every read of the buffer.

```typed
function blend(work: buffer, n: i32, a: i32, b: i32): i32 {
    const scale = 4 * 16;
    let s = 0;
    for (let i = 0; i < n; i = i + 1) {
        s = s + work.charCodeAt(i) * (a * b + scale);
    }
    return s / 8;
}
```

At r0 the lifted program has 7 blocks and 13 statements, and its RV32 image is 96 bytes. Press **Run** in the header: the O2 pipeline makes six revisions (cfg, fold, simplify, constprop, dce, licm), checks the program against r0 after each, and the image shrinks to 88 bytes. On a 40-cell buffer with n = 40, the r0 image runs 531 instructions and the O2 image 451; `a * b + 64` is now computed once, before the loop.

```js
const p = wb.projects.open('blend').program;
p.pipeline('O2');
return p.listing();
```

> **Try it.** Select `s:blend.15` in the IR view after O2 and open Lineage. It says the statement was made by licm at r6 from the value `(a * b) + 64`, which constprop made at r4 from `(a * b) + scale`, which the front end emitted for line 5. The because line names the loop that made the move valid.

## 3. What is reused, and what is not

The workbench reuses from the repo only what its own pass manager does not cover. The front end (parsing, type checking, and the stack code it emits with source spans), the RV32 instruction encoders, the magic numbers for division by constants, the disassembler and the emulator are reused unchanged. Everything a pass could be written against is ours: the store, lifting, revisions, analyses, passes, checks, instruction selection and register allocation.

```svg
<svg viewBox="0 0 680 210" xmlns="http://www.w3.org/2000/svg">
  <g fill="none" stroke-width="1">
    <rect x="10" y="20" width="120" height="44" class="mut f-fill"/>
    <rect x="160" y="20" width="120" height="44" class="ink f-paper"/>
    <rect x="310" y="20" width="150" height="44" class="ink f-paper"/>
    <rect x="490" y="20" width="180" height="44" class="ink f-paper"/>
    <rect x="490" y="130" width="180" height="44" class="mut f-fill"/>
    <rect x="310" y="130" width="150" height="44" class="ink f-paper"/>
    <rect x="160" y="130" width="120" height="44" class="mut f-fill"/>
    <path d="M130 42 H160 M280 42 H310 M460 42 H490 M580 64 V130 M490 152 H460 M310 152 H280" class="ink"/>
    <path d="M385 64 V130" class="acc dash"/>
  </g>
  <text x="70" y="40" text-anchor="middle" class="b">front end</text><text x="70" y="55" text-anchor="middle" class="mut">reused</text>
  <text x="220" y="40" text-anchor="middle" class="b">store, r0</text><text x="220" y="55" text-anchor="middle" class="mut">lifting</text>
  <text x="385" y="40" text-anchor="middle" class="b">passes</text><text x="385" y="55" text-anchor="middle" class="mut">r1 … rN, through tx</text>
  <text x="580" y="40" text-anchor="middle" class="b">instruction selection</text><text x="580" y="55" text-anchor="middle" class="mut">tiles, then linear scan</text>
  <text x="580" y="150" text-anchor="middle" class="b">encoders, disassembler</text><text x="580" y="165" text-anchor="middle" class="mut">reused</text>
  <text x="385" y="150" text-anchor="middle" class="b">image entity</text><text x="385" y="165" text-anchor="middle" class="mut">instructions cover statements</text>
  <text x="220" y="150" text-anchor="middle" class="b">emulator</text><text x="220" y="165" text-anchor="middle" class="mut">reused</text>
  <text x="392" y="100" class="acc">checked against r0 after every pass</text>
  <text x="10" y="200" class="mut">grey: reused from the repo unchanged · black: written for the workbench</text>
</svg>
```
Figure: The layers. Our code sits between pieces reused from the repo's compiler. The reference compiler itself is used only as an oracle: its images were built once, and checks can run them.

## 4. The rules the API keeps

Three rules shape everything you will read:

1. **Entities have readable ids and cannot be changed directly.** `s:blend.7` is a statement, `v:blend.12` a value, `insn:blend+0x1c@r6` an instruction. Handles are read-only proxies; an assignment or a misspelt member is refused with a code and a fix line.
2. **Change goes through passes.** A pass declares what it writes, gets the facts it asked for, and changes the program through a transaction that records what each new thing was made from and why it is valid. Each pass that changes something makes one revision.
3. **Meaning is checked, not assumed.** After every pass the program runs on generated inputs beside r0. The machine code runs beside the evaluator. Results, traps and memory must agree.

The rest of the book takes these one at a time. [The typed language](chapter:language) is next; if you would rather start with passes, [the pass manager](chapter:passes) stands on its own.
