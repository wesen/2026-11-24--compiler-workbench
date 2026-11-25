---
id: backend
title: From statements to RV32
part: Part III · Meaning and machines
projects: blend, div-magic, fixed-point, first-steps
---
# From statements to RV32

`p.compile()` turns the head revision into an **image**: an entity of the program, with an id like `img:blend@r6`, the revision it was made from, and one entity per instruction. The stages are instruction selection on virtual registers, register allocation (next chapter), frames, and encoding with the repo's encoders.

## 1. Tiles

Instruction selection walks each statement's value tree and matches tiles, largest first:

| tree | instructions |
|---|---|
| `x + c`, c fits 12 bits | `addi` |
| `x * 2^k` | `slli` |
| `load32[x + c]` | `lw` with the offset folded in |
| `i < n` feeding a branch | fused: `blt i, n, …` |
| `x / c`, c a constant | `mulh` and shifts (divmagic), or a shift for a power of two |
| `a / b` | `div` behind the zero and overflow tests of [chapter 12](chapter:division) |
| `f(x, y)` | moves to `a0`, `a1`, `jal ra`, a move from `a0` |
| a constant that does not fit | `lui` and `addi` |

Assignments are target-directed: `s = s + x` computes straight into `s`'s register. Locals that are live on entry, other than parameters, are zeroed, because the language zero-initializes and the IR may read a local before an assignment on some path.

Options turn tiles off: `fuse` (compare into branch), `immediates` (I-type forms and `x0`), `divmagic`, `useRanges`. On Blend at r0 all four on give 96 bytes; with `fuse`, `immediates` and `divmagic` off, 116.

## 2. Instructions are entities

```js
const p = wb.projects.open('blend').program;
p.pipeline('O2');
const img = p.compile();
return img.listing('blend');
```

```text
   0x8  mul t2, a2, a3           s:blend.15 line 5
   0xc  addi t2, t2, 64          s:blend.15 line 5
  0x10  blt t1, a1, 0x2c         s:blend.4 line 4
  0x2c  addi t3, t1, 0           s:blend.5 line 5  (copy)
  0x30  lw t4, 0(a0)             s:blend.6 line 5
  0x34  bltu t3, t4, 0x3c        s:blend.6 line 5
  0x38  ebreak                   s:blend.7 line 5  (unreachable)
```

Each instruction records what it covers (a value and its statement), why it exists when it is not obvious (a copy, a spill, a frame), and its origin. The text is not ours: the disassembler from the repo's inspection tools decodes every word back, so the listing shows what the bytes say, not what we meant them to say.

The RV32 view has three modes. **Listing** is the table above, with execution counts after a run. **Diff** compiles two revisions (or one revision with the default options and with yours) and compares them instruction by instruction, with branch targets written as block names so that code which only moved is not counted as changed. On Blend, r0 against r6: 11 instructions the same, 13 removed, 11 added, 96 bytes to 88, and 5901 instructions run to 5027 on 20 generated cases. **Allocation** shows the next chapter's stages.

```js
const p = wb.projects.open('blend').program;
p.pipeline('O2', { checkEach: false });
const d = p.asmDiff('r0', 'r6', { fn: 'blend' });
return { a: d.a, b: d.b, same: d.same, removed: d.removed, added: d.added };
```

## 3. Encoding and running

Encoding uses the repo's encoder functions for R, I, S, B and J formats unchanged; only `lui` and the fixed words for `ret` and `ebreak` are written here. Functions are laid out in source order, labels resolved, then branches and calls encoded with their offsets. The image runs on the repo's emulator, which also checks the calling convention at every call and return: `sp` aligned to 16 bytes, `ra` matching, `s0` to `s11` restored. A violation is a fault, reported apart from a trap, and always fails a check.

`img.heat(fn, args)` runs the image and attributes every executed instruction to source lines through its covers. On Blend after O2, with 40 cells: 451 instructions, 322 of them on line 5.

## 4. Against the reference compiler

Built-in projects carry the image the repo's compiler (`typed-rv32.js`, default policy) made from the same sources. Our O2 images are smaller for all 44 projects: 5160 bytes against 7628. They are usually not faster:

| run | r0 | O2 | reference |
|---|---|---|---|
| Blend, 40 cells | 531 | 451 | 383 |
| Checksum, 40 cells | 446 | 366 | 292 |
| Insertion sort, 10 reversed | 2022 | 2022 | 1533 |
| Collatz, n = 27 | 1590 | 1590 | 1486 |
| Value numbering, n = 40 | 690 | 570 | 695 |

The reference compiler is a real single-pass backend with years of tuning in its tiles and loop shapes; ours is written to be read. Part of the gap is visible in the listings: `t7 = i` survives as a copy in every bounds-checked loop, and loops are laid out with the exit block between the test and the body, so every iteration takes a `jal` back. Both are exercises.

> **Exercise.** Add a `layout` option that places each loop's body right after its head, so the back edge is the only jump per iteration. Measure Blend and Checksum before and after.

[Register allocation](chapter:regalloc) explains where `t0` to `t4`, `a0` and the `s` registers in those listings come from.
