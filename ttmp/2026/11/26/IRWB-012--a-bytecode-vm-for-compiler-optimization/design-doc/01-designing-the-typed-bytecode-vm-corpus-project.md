---
Title: Designing the Typed bytecode VM corpus project
Ticket: IRWB-012
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://corpus/candela-gallery/kernel.typed
      Note: Explicit stacks using fixed frame arrays
    - Path: repo://corpus/reference.md
      Note: Project and generated input specification
    - Path: repo://src/typed/evaluate.ts
      Note: Case generation, evaluator budget and pass equivalence
    - Path: repo://src/typed/lift.ts
      Note: Typed frontend operations lifted into checked workbench IR
    - Path: repo://src/typed/specialize.ts
      Note: Current scalar and field specialization bindings
    - Path: repo://tools/reference-check.mjs
      Note: Reference compiler and emulator comparison
    - Path: repo://vendor/ds-js-os/compiler/typed/typed-wasm.js
      Note: Typed parser and lowering for frame arrays, buffers and match
ExternalSources: []
Summary: A fixed-fuel Typed stack VM for comparing general and bytecode-specialized RV32 images on Fibonacci and checksum fixtures.
LastUpdated: 2026-11-26T10:59:54-05:00
WhatFor: ""
WhenToUse: ""
---

# Designing the Typed bytecode VM corpus project

Build one Typed interpreter, `bytecode-vm`, that runs Fibonacci and a rolling checksum. Both pass bytecode in a buffer and vary the data independently. Partial evaluation with known bytecode should replace instruction fetch and dispatch with direct branches while leaving the data computation dynamic. This is the first Futamura projection. Compare general and specialized images in RV32 instructions per executed guest instruction.

## Interpreter

```text
vmRun(code: buffer, data: buffer): i32
```

Each instruction is two u16 cells, an ASCII opcode and an unsigned operand. Use `charCodeAt` to fetch both cells at `2 * pc` and `2 * pc + 1`. The PC starts at zero and advances by one instruction after each fetch. Jumps supply an absolute instruction index. Use a single `if` / `else if` chain in the table order. Typed's `match` requires an enum and `charCodeAt` produces an i32.

Inside `vmRun`, declare `const stack = new Int32Array(8)` and `const locals = new Int32Array(4)`. Typed zeroes them on entry to their declarations. Keep the arrays and the scalar PC, stack depth, and fuel in this one function. Push by writing `stack[sp]` and incrementing `sp`. Pop by decrementing `sp` and reading `stack[sp]`. Start `sp` at zero. Use Typed's checked array and buffer accesses for out-of-range stack, local, code, and data accesses. The packed code can include zero and high-bit cells. The [Candela kernel](../../../../../../corpus/candela-gallery/kernel.typed) shows the frame-array pattern. See the [Typed frontend](../../../../../../vendor/ds-js-os/compiler/typed/typed-wasm.js) and [lifter](../../../../../../src/typed/lift.ts) for the checked accesses and array initialization.

Give the loop 192 iterations. Each iteration consumes one unit of fuel, including the iteration that halts. Return zero for an unknown opcode or after the loop exhausts fuel. Zero is also a valid result. Bounds traps are observable and the two caller buffers are read-only.

| Opcode | Operand | Effect |
| --- | --- | --- |
| `P` | literal | Push the unsigned operand. |
| `L` | local index | Push the selected local. |
| `S` | local index | Pop and store into the selected local. |
| `A`, `D`, `M` | ignored | Pop right then left and push their sum, difference, or product, respectively, wrapping as i32. |
| `J` | target | Set `pc` to the operand. |
| `Z` | target | Pop a value and set `pc` to the operand if the value is zero. |
| `I` | ignored | Pop an index and push `data.charCodeAt(index)`. |
| `N` | ignored | Push `data.length`. |
| `H` | ignored | Return the top stack value. |

## Fixtures and corpus project

Each numbered entry below is one instruction. Encode it as `[ascii(opcode), operand]`, using zero for missing operands. Keep the canonical listings here and the encoded cells in project inputs or test fixtures. Direct numeric conversion suffices for both listings.

```text
Fibonacci                               Rolling checksum (reverse order)
00 P 0    ; data[0] is n                 00 N
01 I                                    01 S 2    ; index one past next cell
02 S 0    ; iterations remaining        02 L 2    ; loop
03 P 1                                  03 Z 16
04 S 2    ; b, with a = locals[1] = 0    04 L 2
05 L 0    ; loop                        05 P 1
06 Z 20                                 06 D
07 L 1                                  07 S 2
08 L 2                                  08 L 1    ; accumulator starts at 0
09 A                                    09 P 31
10 S 3    ; next                        10 M
11 L 2                                  11 L 2
12 S 1                                  12 I
13 L 3                                  13 A
14 S 2                                  14 S 1
15 L 0                                  15 J 2
16 P 1                                  16 L 1    ; done
17 D                                    17 H
18 S 0
19 J 5
20 L 1    ; done
21 H
```

Fibonacci returns `F(n)` from `data[0]`, with `F(0) = 0` and `F(1) = 1`. It runs `9 + 15*n` instructions, at most 159 for generated n from 0 to 10. The checksum folds the data from right to left with `acc = (31 * acc + cell) mod 2^32`. It runs `6 + 14*length` instructions, at most 174 for generated lengths 0–12. Both peak at two stack elements.

Put the interpreter in `corpus/projects/bytecode-vm/main.typed`. Add `project.json` with title `Bytecode VM`, group `Programs`, sources `["main.typed"]`, pipeline `speed`, and focus on the first dispatch arm. Add `notes.md` with commands to inspect the general VM in the workbench and register the project in [the display order](../../../../../../corpus/projects/index.json). Keep the JS oracle and cross-engine checks in one Node test. See the [corpus API](../../../../../../corpus/reference.md) for the project format.

Under `inputs.vmRun` use these specs. Replace each code placeholder with the encoded numeric cell array. Fibonacci is the project default. Run a fresh checked `speed` pipeline with the checksum spec in the Node test so every changing pass is checked on both workloads.

| Fixture | `code` | `data` |
| --- | --- | --- |
| Fibonacci | `{ "cells": [/* Fibonacci cells */] }` | `{ "buffer": [1, 1], "cell": [0, 10] }` |
| Checksum | `{ "cells": [/* checksum cells */] }` | `{ "buffer": [0, 12], "cell": [0, 65535] }` |

## Correctness and sizing

Implement the JS VM from the opcode table using `switch`, a JS push/pop stack with the same depth limit, and four zeroed locals. Check JS indices explicitly so out-of-range reads and writes are classified as bounds traps. Use `| 0` for addition and subtraction and `Math.imul` for multiplication. Return the i32 or trap outcome and the executed guest instruction count, including halt. Verify the oracle with Fibonacci at 0, 1, and 10 (0, 1, 55), checksum on empty data and `[1, 2, 3]` (0, 2946), and a wrapping multiply (`P 65535; P 65535; M; H` returns −131071). Cover the checked access families with directed traps for truncated code (`P` with no operand cell), stack underflow (`H`), stack overflow (`P 1; J 0`), an invalid local (`L 4`), and an invalid data index (`P 0; I` with empty data). Use a checksum at length 16 with all cells set to 1 to exercise fuel exhaustion on a normal loop path.

Use `casesFrom` to generate cases and `benchCase` for directed calls. Compare the JS outcome against the evaluator at r0, the reference compiler's RV32 image, and the workbench RV32 images at r0 and after checked `speed`. Each run starts from the same input bytes. On normal completion, compare the i32 and verify the caller buffers are unchanged. An expected bounds trap must agree with a trap. Engine faults and limits fail the test. Inspect the per-pass reports for rejections and inconclusive cases. [evaluate.ts](../../../../../../src/typed/evaluate.ts) implements the case generator and pass contract. [reference-check.mjs](../../../../../../tools/reference-check.mjs) shows how to run the reference image.

`meaningKept` caps each case at 20,000 executed IR statements, with 40 cases per function and a default seed of 7. The 192-instruction guest cap gives an initial estimate of 15,616 evaluator statements at 80 per dispatch plus 256 for entry and exit. Verify the actual evaluator steps at r0 and through the checked pipeline on the largest generated cases and the fuel case. Reduce fuel and fixture ranges together if the measured steps leave little room below the limit. Keep RV32 steps separate from this budget.

## Specialization and measurement

For IRWB-007, bind the exact immutable code cells and length and leave `data` and its length dynamic. The [current specializer](../../../../../../src/typed/specialize.ts) handles numeric parameters and record fields. Fixed case-generator cells only specify test inputs. A code-content binding is the prerequisite for comparing specialized images. Once available, compile one variant per fixture and run each on the matching code and the same data cases as the general VM. Compare the variant with general r0 and JS, including the checksum fuel case. Known guest PCs should let the optimizer remove fetch and dispatch and turn guest jumps into direct edges while preserving the data-dependent branches, bounds traps, and fuel behavior.

Use `speed` and the resulting assembly to inspect IRWB-003 loop rotation, copies, spills and register use for `pc`, `sp`, and fuel. For IRWB-006, inspect SSA joins and rule activity on address arithmetic. For IRWB-008, keep the sampled end-to-end gate even where individual rewrites have exact evidence. For IRWB-010, look for a fusion such as `L a; L b; A; S c` with valid indices, sufficient stack and fuel, and no jump into the middle. The exact i32 result is a control case for IRWB-011 float tolerance work.

Report per-case **RV32 emulator steps / JS guest instruction count** for general r0, general `speed`, and each available specialized image. Count the whole call in the numerator and include HALT in the denominator. Use identical inputs and backend options, record the compiler revision and input seed, and include the raw numerator and denominator so the comparison is reproducible. Check assembly and executed instruction counts for changes in dispatch, frame traffic, and bounds checks.

## Implementation order

1. Encode the fixture listings directly and verify them with the independently written JS oracle.
2. Implement the single Typed entry, add the corpus metadata and notes, and run the evaluator and reference image checks.
3. Run the checked `speed` pipeline on both generators, verify the step budget, and record the general measurements. Add the specialized comparison once constant-memory bindings are available.

## Cuts from the original design

- Removed the output buffer, status codes, and duplicate guest bounds guards. An i32 result and Typed’s existing bounds traps cover the experiment.
- Removed input-size restrictions and detailed malformed-code rules. Generated sizes and one fuel cap bound execution.
- Dropped the optional decode helper and sized the frame to the fixtures. A single ordinary dispatch loop exposes the state the optimizer needs to improve.
- Removed bytecode that initialized already-zero locals. The VM supplies zero initialization on every call.
- Replaced the assembler and duplicate encoded listings with direct conversion of the numbered fixtures.
- Dropped a separate workbench script and sample JSON scaffolding. The project notes and one Node harness cover inspection and testing.
- Trimmed malformed-input cases, the padded fuel-boundary program, and the second step threshold. Direct bounds cases and a regular fuel-exhausting loop exercise the relevant behavior.
- Dropped the extra O2 run, aggregate ratio and code-size report. Matched per-case r0, `speed`, and specialized instruction counts answer the speed question.
- Deferred the variant router, separate hand-written ceiling, and specializer implementation recipe. The experiment needs a code-binding contract and matched calls to each image.
- Condensed the research references and implementation sequence to the work the corpus project requires.
